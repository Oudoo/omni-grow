import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { Client } from './business-test-client.mjs';
const f = JSON.parse(await readFile('.local/business-test-state.json', 'utf8'));
const operator = await Client.restore(f.users.operator.state), owner = await Client.restore(f.users.ownerA.state);
let employee = await Client.restore(f.users.outsiderA.state);
const outcomes = [], sockets = [];
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto('http://localhost:3000/login');
await page.addScriptTag({ path: 'node_modules/livekit-client/dist/livekit-client.umd.js' });
async function check(name, task) { await task(); outcomes.push(name); console.log(`PASS ${name}`); }
function fixture(action, extra = {}) {
  const result = spawnSync('docker', ['exec', '-i', 'omnigrow-rails-1', 'bundle', 'exec', 'rails', 'runner', '/app/omnigrow/test_fixture.rb'], { input: JSON.stringify({ run: f.run, action, account_id: f.alpha.account_id, ...extra }), encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Scoped fixture ${action} failed: ${result.stderr.slice(-700)}`);
  assert(result.stdout.includes('OG_BUSINESS_FIXTURE_ACTION_OK'));
}
async function until(fn, message, timeout = 15000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(message); }
async function packageUpdate(plan = 'business', status = 'active') { return operator.call(`/api/operator/businesses/${f.alpha.account_id}`, 'PATCH', { plan, status, seat_limit: 6, storage_limit_bytes: 10 * 1024 ** 2 }); }
async function nativeSocket() {
  const response = await owner.native('/api/v1/profile'), profile = await response.json();
  const identity = profile.data || profile;
  const identifier = JSON.stringify({ channel: 'RoomChannel', pubsub_token: identity.pubsub_token, user_id: identity.id, account_id: f.alpha.account_id });
  const socket = new WebSocket('ws://localhost:3001/cable', ['actioncable-v1-json']);
  const result = { socket, messages: [], ready: false };
  socket.addEventListener('open', () => socket.send(JSON.stringify({ command: 'subscribe', identifier })));
  socket.addEventListener('message', event => { const value = JSON.parse(event.data); if (value.type === 'confirm_subscription') result.ready = true; if (value.message) result.messages.push(value.message); });
  sockets.push(socket); await until(() => result.ready, 'Native socket must subscribe'); return result;
}
async function connect(admission) { return page.evaluate(async admission => { window.__testRoom?.disconnect(); const room = new window.LivekitClient.Room(); window.__testRoom = room; try { await room.connect(admission.url, admission.token); return room.state === 'connected'; } catch { return false; } }, admission); }
let activeMeeting;
try {
  await check('native websocket filters existing subscriptions immediately on package change and suspension', async () => {
    const live = await nativeSocket();
    const sent = randomUUID(); fixture('probe_event', { user_id: f.users.ownerA.profile.id, sentinel: sent });
    await until(() => live.messages.some(item => item.data?.content === sent), 'Initial native event must arrive');
    await packageUpdate('team');
    const blocked = randomUUID(); fixture('probe_event', { user_id: f.users.ownerA.profile.id, sentinel: blocked });
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert(!live.messages.some(item => item.data?.content === blocked), 'Downgrade must block queued customer content');
    await packageUpdate();
    const resumed = randomUUID(); fixture('probe_event', { user_id: f.users.ownerA.profile.id, sentinel: resumed });
    await until(() => live.messages.some(item => item.data?.content === resumed), 'Restored package must deliver again');
    fixture('native_suspend');
    const suspended = randomUUID(); fixture('probe_event', { user_id: f.users.ownerA.profile.id, sentinel: suspended });
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert(!live.messages.some(item => item.data?.content === suspended));
    await owner.call('/api/business/context', 'GET', undefined, [401, 403]);
    await packageUpdate();
  });
  await check('missing SFU rooms reconcile without trapping channels in stale meetings', async () => {
    fixture('stale_meeting', { room_id: f.publicRoom.id, user_id: f.users.ownerA.profile.id });
    const old = (await owner.call(`/api/business/rooms/${f.publicRoom.id}`)).meeting;
    await owner.call(`/api/business/rooms/${f.publicRoom.id}/meetings/${old.id}/join`, 'POST', {}, 410);
    assert.equal((await owner.call(`/api/business/rooms/${f.publicRoom.id}`)).meeting, null);
    fixture('stale_meeting', { room_id: f.publicRoom.id, user_id: f.users.ownerA.profile.id });
    activeMeeting = await owner.call(`/api/business/rooms/${f.publicRoom.id}/meetings`, 'POST', {}, 201);
    const admission = await owner.call(`/api/business/rooms/${f.publicRoom.id}/meetings/${activeMeeting.id}/join`, 'POST');
    assert(await connect(admission));
    await owner.call(`/api/business/rooms/${f.publicRoom.id}/meetings/${activeMeeting.id}`, 'DELETE'); activeMeeting = undefined;
  });
  await check('native membership reassignment is rejected and removal terminates held meeting access', async () => {
    fixture('native_reassign', { user_id: f.users.outsiderA.profile.id, destination_id: f.beta.account_id });
    const before = await owner.call('/api/business/rooms', 'POST', { kind: 'direct', member_ids: [f.users.outsiderA.profile.id] }, 201);
    activeMeeting = await owner.call(`/api/business/rooms/${f.publicRoom.id}/meetings`, 'POST', {}, 201);
    const admission = await employee.call(`/api/business/rooms/${f.publicRoom.id}/meetings/${activeMeeting.id}/join`, 'POST');
    assert(await connect(admission));
    fixture('native_remove', { user_id: f.users.outsiderA.profile.id });
    await until(() => page.evaluate(() => window.__testRoom.state === 'disconnected'), 'Removed member must be disconnected');
    assert(JSON.parse(Buffer.from(admission.token.split('.')[1], 'base64url')).exp > Date.now() / 1000, 'Old token must still be within its admission lifetime for this test');
    assert.equal(await connect(admission), false, 'An unexpired old token must not recreate an ended room'); activeMeeting = undefined;
    await employee.call('/api/business/context', 'GET', undefined, [401, 403]);
    const invite = await owner.call('/api/business/invitations', 'POST', { name: 'Alpha outsider', email: f.users.outsiderA.profile.email, role: 'agent' }, 201);
    employee = await new Client().login(f.users.outsiderA.profile.email, f.password);
    assert.equal(employee.state.accountId, undefined, 'Last-membership removal yields an identity-only login');
    await employee.call('/api/business/context', 'GET', undefined, 401);
    assert.equal((await employee.call('/api/invitations/preview', 'POST', { token: invite.token })).signed_in_as_invitee, true);
    await employee.call('/api/invitations/accept', 'POST', { token: invite.token });
    employee = await new Client().login(f.users.outsiderA.profile.email, f.password);
    const after = await owner.call('/api/business/rooms', 'POST', { kind: 'direct', member_ids: [f.users.outsiderA.profile.id] }, 201);
    assert.notEqual(after.id, before.id);
    await employee.call(`/api/business/rooms/${before.id}/messages`, 'GET', undefined, 404);
    f.users.outsiderA.state = employee.storageState();
    await writeFile('.local/business-test-state.json', JSON.stringify(f, null, 2), { mode: 0o600 });
  });
  await check('native account suspension ends real media connections and blocks new admissions', async () => {
    activeMeeting = await owner.call(`/api/business/rooms/${f.publicRoom.id}/meetings`, 'POST', {}, 201);
    const admission = await owner.call(`/api/business/rooms/${f.publicRoom.id}/meetings/${activeMeeting.id}/join`, 'POST');
    assert(await connect(admission));
    fixture('native_suspend');
    await until(() => page.evaluate(() => window.__testRoom.state === 'disconnected'), 'Suspended business must lose the live connection');
    await owner.call(`/api/business/rooms/${f.publicRoom.id}/meetings/${activeMeeting.id}/join`, 'POST', {}, [401, 403]);
    await packageUpdate(); activeMeeting = undefined;
  });
  console.log(`Passed ${outcomes.length} real lifecycle/realtime checks.`);
} finally {
  await packageUpdate().catch(() => {});
  if (activeMeeting) await owner.call(`/api/business/rooms/${f.publicRoom.id}/meetings/${activeMeeting.id}`, 'DELETE').catch(() => {});
  for (const socket of sockets) socket.close();
  await browser.close();
  await writeFile('.local/business-lifecycle-results.json', JSON.stringify({ passed: outcomes.length, checks: outcomes }, null, 2));
}
