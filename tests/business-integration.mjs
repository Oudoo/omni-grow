import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { Client } from './business-test-client.mjs';

const run = `ogbiz${randomBytes(8).toString('hex')}`;
const password = `${randomBytes(24).toString('base64url')}aA1!`;
const outcomes = [];
function fixture(action) {
  const result = spawnSync('docker', ['exec', '-i', 'omnigrow-rails-1', 'bundle', 'exec', 'rails', 'runner', '/app/omnigrow/test_fixture.rb'], { input: JSON.stringify({ run, action }), encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Fixture ${action} failed: ${result.stderr.slice(-1200)}`);
  if (action === 'create') return JSON.parse(result.stdout.split('\n').find(line => line.startsWith('OG_BUSINESS_FIXTURE:')).split('OG_BUSINESS_FIXTURE:')[1]);
}
async function check(name, task) { await task(); outcomes.push(name); console.log(`PASS ${name}`); }
let complete = false;
const keep = process.env.OG_KEEP_BUSINESS_FIXTURE === '1';
try {
  const seed = fixture('create');
  const operator = await new Client().login(seed.operator.email, seed.operator.password), anon = new Client();
  let alpha, beta, ownerA, ownerB, memberA, outsiderA, privateRoom, publicRoom, directRoom, document, message, invitation;
  await check('authentication, operator-only business provisioning and package assignment', async () => {
    await anon.call('/api/business/context', 'GET', undefined, 401);
    const payload = { client_id: randomUUID(), name: `OG business test ${run} Alpha`, owner_name: 'Alpha owner', owner_email: `${run}-alpha@example.test`, plan: 'business', seat_limit: 6, storage_limit_bytes: 10 * 1024 ** 2 };
    alpha = await operator.call('/api/operator/businesses', 'POST', payload, 201);
    const repeated = await operator.call('/api/operator/businesses', 'POST', payload, 201);
    assert.equal(repeated.business.account_id, alpha.business.account_id); assert.equal(repeated.replayed, true);
    await operator.call('/api/operator/businesses', 'POST', { ...payload, name: 'Altered retry' }, 409);
    beta = await operator.call('/api/operator/businesses', 'POST', { ...payload, client_id: randomUUID(), name: `OG business test ${run} Beta`, owner_name: 'Beta owner', owner_email: `${run}-beta@example.test`, plan: 'team' }, 201);
    await anon.call('/api/invitations/accept', 'POST', { token: alpha.token, password });
    await anon.call('/api/invitations/accept', 'POST', { token: beta.token, password });
    ownerA = await new Client().login(payload.owner_email, password);
    ownerB = await new Client().login(`${run}-beta@example.test`, password);
    await ownerA.call('/api/operator/businesses', 'GET', undefined, 403);
    assert.equal((await ownerB.call('/api/business/context')).business.inbox_enabled, false);
    await ownerB.native(`/api/v1/accounts/${beta.business.account_id}/conversations`, 'GET', undefined, 403);
    await ownerB.call('/api/workspace/conversations', 'GET', undefined, 403);
  });
  await check('single-use invitations, real employee sign-in and current roles', async () => {
    await anon.call('/api/invitations/accept', 'POST', { token: alpha.token, password }, 410);
    invitation = await ownerA.call('/api/business/invitations', 'POST', { name: 'Alpha employee', email: `${run}-employee@example.test`, role: 'agent' }, 201);
    const weak = await anon.call('/api/invitations/accept', 'POST', { token: invitation.token, password: 'weakpassword1234' }, 422);
    assert.match(weak.error, /uppercase/i, 'A rejected password must explain the engine policy to the invited employee.');
    await anon.call('/api/invitations/accept', 'POST', { token: invitation.token, password });
    memberA = await new Client().login(`${run}-employee@example.test`, password);
    const other = await ownerA.call('/api/business/invitations', 'POST', { name: 'Alpha outsider', email: `${run}-outsider@example.test`, role: 'agent' }, 201);
    await anon.call('/api/invitations/accept', 'POST', { token: other.token, password });
    outsiderA = await new Client().login(`${run}-outsider@example.test`, password);
    await memberA.call('/api/business/invitations', 'POST', { name: 'Denied', email: `${run}-denied@example.test` }, 403);
    for (const path of [`${alpha.business.account_id}/agents`, `${alpha.business.account_id}/agents.json`, `%${alpha.business.account_id.toString().charCodeAt(0).toString(16)}${String(alpha.business.account_id).slice(1)}/agents`]) {
      await ownerA.native(`/api/v1/accounts/${path}`, 'POST', { agent: { name: 'Bypass', email: `${run}-bypass@example.test` } }, 403);
    }
  });
  await check('tenant and private-channel isolation including native routes', async () => {
    privateRoom = await ownerA.call('/api/business/rooms', 'POST', { kind: 'private', name: 'Leadership', member_ids: [memberA.state.profile.id] }, 201);
    publicRoom = await ownerA.call('/api/business/rooms', 'POST', { kind: 'public', name: 'Company news', member_ids: [] }, 201);
    assert((await memberA.call('/api/business/rooms')).rooms.some(room => room.id === privateRoom.id));
    assert(!(await outsiderA.call('/api/business/rooms')).rooms.some(room => room.id === privateRoom.id));
    await outsiderA.call(`/api/business/rooms/${privateRoom.id}/messages`, 'GET', undefined, 404);
    await ownerB.call(`/api/business/rooms/${privateRoom.id}/messages`, 'GET', undefined, 404);
    await ownerB.native(`/api/v1/accounts/${alpha.business.account_id}/business/rooms`, 'GET', undefined, 401);
    await ownerA.call('/api/business/rooms', 'POST', { kind: 'private', name: 'Invalid members', member_ids: [ownerB.state.profile.id] }, 422);
    directRoom = await ownerA.call('/api/business/rooms', 'POST', { kind: 'direct', member_ids: [memberA.state.profile.id] }, 201);
    const same = await memberA.call('/api/business/rooms', 'POST', { kind: 'direct', member_ids: [ownerA.state.profile.id] }, 201);
    assert.equal(same.id, directRoom.id);
    await ownerA.call(`/api/business/rooms/${directRoom.id}`, 'PATCH', { member_ids: [outsiderA.state.profile.id] }, 422);
  });
  await check('persistent messages, concurrent deduplication, threads and private search', async () => {
    const body = { content: 'The private annual plan', client_id: randomUUID() };
    const pair = await Promise.all([memberA.call(`/api/business/rooms/${privateRoom.id}/messages`, 'POST', body, 201), memberA.call(`/api/business/rooms/${privateRoom.id}/messages`, 'POST', body, 201)]);
    assert.equal(pair[0].id, pair[1].id); message = pair[0];
    await memberA.call(`/api/business/rooms/${privateRoom.id}/messages`, 'POST', { ...body, content: 'Different attempt content' }, 409);
    const reply = await ownerA.call(`/api/business/rooms/${privateRoom.id}/messages`, 'POST', { content: 'Acknowledged', reply_to_id: message.id, client_id: randomUUID() }, 201);
    assert.equal(reply.reply_to_id, message.id);
    assert.equal((await ownerA.call(`/api/business/rooms/${privateRoom.id}/messages?q=annual`)).messages.length, 1);
    await outsiderA.call(`/api/business/rooms/${privateRoom.id}/messages?q=annual`, 'GET', undefined, 404);
    await memberA.call(`/api/business/rooms/${publicRoom.id}/messages`, 'POST', { content: 'Invalid cross-room reply', reply_to_id: message.id, client_id: randomUUID() }, 404);
  });
  await check('document bytes, download authorization and absence of public storage capabilities', async () => {
    const bytes = randomBytes(4096), form = new FormData();
    form.set('room_id', String(privateRoom.id)); form.set('client_id', randomUUID()); form.set('file', new Blob([bytes]), 'board-plan.pdf');
    document = await memberA.call('/api/business/documents', 'POST', form, 201);
    assert.equal(document.checksum, createHash('sha256').update(bytes).digest('hex'));
    assert(!/signed_id|blob_id|service_url|data_url|storage_key/.test(JSON.stringify(document)));
    const download = await ownerA.call(`/api/business/documents/${document.id}/content`);
    assert.deepEqual(download.bytes, bytes); assert.match(download.response.headers.get('cache-control'), /no-store/); assert.match(download.response.headers.get('content-disposition'), /attachment/);
    await outsiderA.call(`/api/business/documents/${document.id}/content`, 'GET', undefined, 404);
    await ownerB.call(`/api/business/documents/${document.id}/content`, 'GET', undefined, 404);
    await outsiderA.native(`/api/v1/accounts/${alpha.business.account_id}/business/documents/${document.id}/content`, 'GET', undefined, 404);
    assert.equal((await outsiderA.call('/api/business/documents?q=board')).documents.length, 0);
  });
  await check('existing identity acceptance cannot reset another tenant password', async () => {
    const invite = await ownerB.call('/api/business/invitations', 'POST', { name: 'Alpha employee', email: `${run}-employee@example.test`, role: 'agent' }, 201);
    await anon.call('/api/invitations/accept', 'POST', { token: invite.token, password: 'AttackerCannotReset123!' }, 401);
    await memberA.call('/api/invitations/accept', 'POST', { token: invite.token, password: 'IgnoredPassword123!' });
    await ownerB.call(`/api/business/members/${memberA.state.profile.id}`, 'DELETE');
    assert.equal((await memberA.call('/api/business/context')).business.account_id, alpha.business.account_id);
  });
  await check('parallel invitations reserve seats and revoked links cannot join', async () => {
    await operator.call(`/api/operator/businesses/${alpha.business.account_id}`, 'PATCH', { plan: 'business', status: 'active', seat_limit: 4, storage_limit_bytes: 10 * 1024 ** 2 });
    const responses = await Promise.all([1, 2].map(number => ownerA.call('/api/business/invitations', 'POST', { name: 'Reserved employee', email: `${run}-reserved${number}@example.test`, role: 'agent' }, [201, 422])));
    assert.deepEqual(responses.map(item => item.status).sort(), [201, 422]);
    const invite = responses.find(item => item.status === 201).data;
    await ownerA.call(`/api/business/invitations/${invite.invitation.id}`, 'DELETE');
    await anon.call('/api/invitations/accept', 'POST', { token: invite.token, password }, 410);
    await operator.call(`/api/operator/businesses/${alpha.business.account_id}`, 'PATCH', { plan: 'business', status: 'active', seat_limit: 6, storage_limit_bytes: 10 * 1024 ** 2 });
  });
  await check('parallel uploads cannot exceed tenant storage, retries keep one document', async () => {
    const used = (await ownerA.call('/api/business/context')).business.storage_used_bytes;
    await operator.call(`/api/operator/businesses/${alpha.business.account_id}`, 'PATCH', { plan: 'business', status: 'active', seat_limit: 6, storage_limit_bytes: used + 150 });
    const upload = async (id, size, expected) => { const form = new FormData(); form.set('room_id', String(publicRoom.id)); form.set('client_id', id); form.set('file', new Blob([new Uint8Array(size)]), 'quota.txt'); return ownerA.call('/api/business/documents', 'POST', form, expected); };
    const ids = [randomUUID(), randomUUID()];
    const results = await Promise.all(ids.map(id => upload(id, 100, [201, 422])));
    assert.deepEqual(results.map(item => item.status).sort(), [201, 422]);
    const index = results.findIndex(item => item.status === 201), saved = results[index].data;
    assert.equal((await upload(ids[index], 100, 201)).id, saved.id);
    await upload(ids[index], 101, 409);
    await ownerA.call(`/api/business/documents/${saved.id}`, 'DELETE');
    await operator.call(`/api/operator/businesses/${alpha.business.account_id}`, 'PATCH', { plan: 'business', status: 'active', seat_limit: 6, storage_limit_bytes: 10 * 1024 ** 2 });
  });
  await check('business branding stores a real private logo and administrators remain required', async () => {
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8X8AAAAASUVORK5CYII=', 'base64');
    const form = new FormData(); form.set('name', alpha.business.name); form.set('description', 'Private business acceptance workspace'); form.set('website', 'https://growcdx.com'); form.set('accent_color', '#295c46'); form.set('logo', new Blob([bytes], { type: 'image/png' }), 'logo.png');
    const business = await ownerA.call('/api/business/branding', 'PATCH', form);
    assert.equal(business.has_logo, true); assert(business.logo_version);
    assert.deepEqual((await ownerA.call('/api/business/logo')).bytes, bytes);
    await memberA.call('/api/business/branding', 'PATCH', { name: 'Unauthorized brand' }, 403);
    await ownerA.call(`/api/business/members/${ownerA.state.profile.id}`, 'DELETE', undefined, 422);
    await ownerA.call(`/api/business/members/${ownerA.state.profile.id}`, 'PATCH', { role: 'agent' }, 422);
  });
  await mkdir('.local', { recursive: true });
  await writeFile('.local/business-test-state.json', JSON.stringify({ run, password, alpha: alpha.business, beta: beta.business, privateRoom, publicRoom, directRoom, document, message, users: { operator: { state: operator.storageState(), profile: operator.state.profile }, ownerA: { state: ownerA.storageState(), profile: ownerA.state.profile }, ownerB: { state: ownerB.storageState(), profile: ownerB.state.profile }, memberA: { state: memberA.storageState(), profile: memberA.state.profile }, outsiderA: { state: outsiderA.storageState(), profile: outsiderA.state.profile } } }, null, 2), { mode: 0o600 });
  await writeFile('.local/business-integration-results.json', JSON.stringify({ passed: outcomes.length, checks: outcomes, fixtureRetained: keep }, null, 2));
  console.log(`Passed ${outcomes.length} real-service business checks.`);
  complete = true;
} finally {
  if (!keep || !complete) fixture('cleanup');
  else console.log(`Retained isolated fixture ${run} for browser/media verification.`);
}
