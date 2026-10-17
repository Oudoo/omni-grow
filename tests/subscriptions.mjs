// Real local application, database, worker and SFU acceptance for hosted leases.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium, expect as baseExpect } from '@playwright/test';
import { Client } from './business-test-client.mjs';

if (process.env.OG_PRODUCTION === '1' || process.env.OG_COMPOSE_PROJECT) throw new Error('Subscription acceptance is local-only.');
const run = `ogbiz${randomBytes(8).toString('hex')}`;
const password = `${randomBytes(24).toString('base64url')}aA1!`;
const checks = [];
const expect = baseExpect.configure({ timeout: 20000 });
let browser;
const sockets = [];
function fixture(action, extra = {}) {
  const r = spawnSync('docker', ['exec', '-i', 'omnigrow-rails-1', 'bundle', 'exec', 'rails', 'runner', '/app/omnigrow/test_fixture.rb'], { input: JSON.stringify({ run, action, ...extra }), encoding: 'utf8', maxBuffer: 1024 ** 2 });
  assert.equal(r.status, 0, `Scoped fixture ${action} failed.`);
  if (action === 'create') return JSON.parse(r.stdout.split('\n').find(line => line.startsWith('OG_BUSINESS_FIXTURE:')).split('OG_BUSINESS_FIXTURE:')[1]);
}
async function check(name, task) { await task(); checks.push(name); console.log(`PASS ${name}`); }
async function until(task, message, timeout = 20000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await task()) return; await new Promise(resolve => setTimeout(resolve, 200)); } throw new Error(message); }
try {
  const seed = fixture('create');
  const operator = await new Client().login(seed.operator.email, seed.operator.password);
  const created = await operator.call('/api/operator/businesses', 'POST', { client_id: randomUUID(), name: `OG business test ${run} Subscriber`, owner_name: 'Subscriber owner', owner_email: `${run}-owner@example.test`, plan: 'business', seat_limit: 5, storage_limit_bytes: 1024 ** 3 }, 201);
  const path = `/api/operator/businesses/${created.business.account_id}/subscription`;
  const change = { operation: 'activate', interval: 'monthly', starts_at: new Date().toISOString(), amount_minor: 12500, currency: 'USD', grace_days: 3, reference: 'Acceptance bank payment', version: 0, client_id: randomUUID() };
  let business;
  await check('operator activates a real monthly lease with a recorded payment reference', async () => {
    business = (await operator.call(path, 'POST', change)).business;
    assert.equal(business.subscription.interval, 'monthly');
    assert.equal(business.subscription.status, 'active');
    assert.equal(business.subscription.amount_minor, 12500);
    assert.equal(business.access_enabled, true);
  });
  const anonymous = new Client();
  await anonymous.call('/api/invitations/accept', 'POST', { token: created.token, password });
  const owner = await new Client().login(`${run}-owner@example.test`, password);
  const room = await owner.call('/api/business/rooms', 'POST', { kind: 'public', name: 'Subscription acceptance', member_ids: [] }, 201);
  await owner.call(`/api/business/rooms/${room.id}/messages`, 'POST', { content: 'Retained through expiry and renewal', client_id: randomUUID() }, 201);
  const upload = new FormData(); upload.set('room_id', String(room.id)); upload.set('client_id', randomUUID()); upload.set('file', new Blob(['Private subscription bytes\n']), 'subscription.txt');
  const document = await owner.call('/api/business/documents', 'POST', upload, 201);
  const update = async (values, expected = 200) => {
    const body = { version: business.subscription.version, client_id: randomUUID(), reference: `Acceptance ${randomUUID()}`, ...values };
    const response = await operator.call(path, 'POST', body, expected);
    if (expected === 200) business = response.business;
    return response;
  };
  await check('only the operator can change terms; customer administrators can read their subscription', async () => {
    await owner.call(path, 'POST', { ...change, version: business.subscription.version }, 403);
    await owner.call('/api/business/subscription', 'POST', change, 404);
    assert.equal((await owner.call('/api/business/subscription')).subscription.amount_minor, 12500);
    await anonymous.call(path, 'GET', undefined, 401);
    await update({ ...change, client_id: randomUUID(), version: business.subscription.version, reference: `Invalid currency ${randomUUID()}`, currency: 'BAD' }, 422);
  });
  await check('concurrent renewal retries add one period and a reused payment reference cannot add another', async () => {
    const body = { operation: 'renew', version: business.subscription.version, client_id: randomUUID(), reference: `Payment ${randomUUID()}` };
    const responses = await Promise.all([operator.call(path, 'POST', body), operator.call(path, 'POST', body)]);
    business = responses[0].business;
    assert.equal(business.subscription.version, 2);
    assert.equal(new Set(responses.map(item => item.business.subscription.paid_through)).size, 1);
    assert(responses.some(item => item.replayed));
    await update({ operation: 'renew', reference: body.reference.toUpperCase() }, 409);
    await operator.call(path, 'POST', { ...body, reference: 'Changed retry details' }, 409);
    assert.equal((await operator.call(path)).changes.length, 2);
  });
  await check('stale edits cannot overwrite another operator and invalid references leave the term unchanged', async () => {
    await update({ operation: 'cancel', version: 0 }, 409);
    await update({ operation: 'cancel', reference: '' }, 422);
    assert.equal((await operator.call(path)).business.subscription.version, business.subscription.version);
    fixture('subscription_calendar', { account_id: business.account_id });
  });
  await check('invalid calendar dates are rejected and numeric strings use decimal amounts and grace days', async () => {
    for (const starts_at of ['2026-02-31T00:00:00Z', '2026-10-17T24:00:00Z', '2026-10-17T00:00:60Z', '2026-10-17T00:00:00+14:01', '2026-10-17T00:00:00+00:60']) {
      await update({ ...change, client_id: randomUUID(), version: business.subscription.version, reference: `Invalid date ${randomUUID()}`, starts_at }, 422);
    }
    assert.equal((await operator.call(path)).business.subscription.version, business.subscription.version);
    await update({ ...change, client_id: randomUUID(), version: `000${business.subscription.version}`, reference: `Decimal strings ${randomUUID()}`, amount_minor: '00008', grace_days: '010' });
    assert.equal(business.subscription.amount_minor, 8);
    assert.equal(business.subscription.grace_days, 10);
  });
  await check('future activation blocks native and branded data access while preserving subscription status', async () => {
    await update({ ...change, client_id: randomUUID(), version: business.subscription.version, reference: `Scheduled ${randomUUID()}`, starts_at: new Date(Date.now() + 86400000).toISOString() });
    assert.equal(business.subscription.status, 'scheduled'); assert.equal(business.access_enabled, false);
    await owner.call('/api/business/rooms', 'GET', undefined, 402);
    await owner.call(`/api/business/documents/${document.id}/content`, 'GET', undefined, 402);
    await owner.native(`/api/v1/accounts/${business.account_id}/conversations`, 'GET', undefined, 402);
    await owner.call('/api/realtime', 'GET', undefined, 403);
    assert.equal((await owner.call('/api/business/context')).business.subscription.status, 'scheduled');
    await update({ ...change, client_id: randomUUID(), version: business.subscription.version, reference: `Active ${randomUUID()}`, grace_days: 0 });
  });
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox'] });
  const media = await browser.newPage(); await media.goto('http://localhost:3000/login');
  await media.addScriptTag({ path: 'node_modules/livekit-client/dist/livekit-client.umd.js' });
  const connect = admission => media.evaluate(async admission => { window.__room?.disconnect(); const room = new window.LivekitClient.Room(); window.__room = room; try { await room.connect(admission.url, admission.token); return room.state === 'connected'; } catch { return false; } }, admission);
  await check('expiry blocks new access and the real worker disconnects an established meeting', async () => {
    const meeting = await owner.call(`/api/business/rooms/${room.id}/meetings`, 'POST', {}, 201);
    const admission = await owner.call(`/api/business/rooms/${room.id}/meetings/${meeting.id}/join`, 'POST');
    assert(await connect(admission));
    const identityResponse = await owner.native('/api/v1/profile'); const profile = await identityResponse.json(); const identity = profile.data || profile;
    const identifier = JSON.stringify({ channel: 'RoomChannel', pubsub_token: identity.pubsub_token, user_id: identity.id, account_id: business.account_id });
    const socket = new WebSocket('ws://localhost:3001/cable', ['actioncable-v1-json']); sockets.push(socket);
    const messages = []; let ready = false;
    socket.addEventListener('open', () => socket.send(JSON.stringify({ command: 'subscribe', identifier })));
    socket.addEventListener('message', event => { const value = JSON.parse(event.data); if (value.type === 'confirm_subscription') ready = true; if (value.message) messages.push(value.message); });
    await until(() => ready, 'Native subscription must connect before expiry.');
    fixture('expire_subscription', { account_id: business.account_id });
    await until(() => media.evaluate(() => window.__room.state === 'disconnected'), 'Expired subscriber must leave the actual SFU room.', 45000);
    assert(JSON.parse(Buffer.from(admission.token.split('.')[1], 'base64url')).exp > Date.now() / 1000, 'Admission token must still be unexpired.');
    assert.equal(await connect(admission), false, 'An old token cannot recreate the ended room.');
    await owner.call(`/api/business/rooms/${room.id}/meetings/${meeting.id}/join`, 'POST', {}, 402);
    const sentinel = randomUUID(); fixture('probe_event', { account_id: business.account_id, user_id: identity.id, sentinel });
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert(!messages.some(item => item.data?.content === sentinel), 'Already-open native sockets must filter expired access.');
    business = (await operator.call(path)).business;
    assert.equal(business.subscription.status, 'expired');
  });
  await check('renewal restores retained documents and never overrides an independent account suspension', async () => {
    await update({ operation: 'renew' });
    assert.equal((await owner.call(`/api/business/documents/${document.id}/content`)).bytes.toString(), 'Private subscription bytes\n');
    assert((await owner.call(`/api/business/rooms/${room.id}/messages`)).messages.some(message => message.content === 'Retained through expiry and renewal'));
    const attrs = { plan: 'business', seat_limit: 5, storage_limit_bytes: 1024 ** 3 };
    await operator.call(`/api/operator/businesses/${business.account_id}`, 'PATCH', { ...attrs, status: 'suspended' });
    await update({ operation: 'renew' });
    assert.equal(business.access_enabled, false); assert.equal(business.status, 'suspended');
    await operator.call(`/api/operator/businesses/${business.account_id}`, 'PATCH', { ...attrs, status: 'active' });
  });
  await check('operator can activate yearly pricing in the browser and the customer sees their actual terms', async () => {
    const opContext = await browser.newContext({ storageState: operator.storageState() }); const op = await opContext.newPage();
    await op.goto('http://localhost:3000/operator');
    await op.locator('.operator-card').filter({ hasText: business.name }).getByRole('button', { name: 'Manage subscription' }).click();
    await op.getByRole('combobox', { name: /^Billing interval/ }).selectOption('yearly');
    await op.getByRole('combobox', { name: /^Currency/ }).selectOption('KWD');
    await op.getByLabel('Agreed price per period').fill('99.125');
    await op.getByLabel('Unique payment or invoice reference').fill(`Browser payment ${randomUUID()}`);
    await op.getByRole('button', { name: 'Save subscription', exact: true }).click();
    await expect(op.getByRole('status')).toHaveText('Subscription updated.');
    business = (await operator.call(path)).business;
    assert.equal(business.subscription.interval, 'yearly'); assert.equal(business.subscription.amount_minor, 99125);
    const ownerContext = await browser.newContext({ storageState: owner.storageState() }); const customer = await ownerContext.newPage();
    await customer.goto('http://localhost:3000/business');
    await customer.getByRole('button', { name: 'Subscription', exact: true }).click();
    await expect(customer.locator('.subscription-summary')).toContainText('Yearly subscription');
    await expect(customer.locator('.subscription-summary')).toContainText('99.125');
    await op.getByRole('combobox', { name: /^Subscription action/ }).selectOption('cancel');
    await op.getByLabel('Contract or adjustment reference').fill(`Cancellation ${randomUUID()}`);
    await op.getByRole('button', { name: 'End business access' }).click();
    await expect(customer.getByRole('heading', { name: 'This business needs activation' })).toBeVisible({ timeout: 30000 });
    await opContext.close(); await ownerContext.close();
    business = (await operator.call(path)).business;
    await update({ operation: 'unlimited' });
    assert.equal((await owner.call('/api/business/context')).business.subscription.status, 'unlimited');
  });
  console.log(`Passed ${checks.length} real subscription checks.`);
} finally {
  for (const socket of sockets) socket.close();
  await browser?.close();
  fixture('cleanup');
  await writeFile('.local/subscription-results.json', JSON.stringify({ passed: checks.length, checks }, null, 2));
}
