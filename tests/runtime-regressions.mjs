import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { sealData } from 'iron-session';
import { chromium } from '@playwright/test';

// Exercises the built Next proxy and browser composer against a deterministic failure boundary.
// Real-engine persistence is covered separately in tests/e2e/omnigrow.spec.ts.
await mkdir('.local', { recursive: true, mode: 0o700 });
const base = process.env.OG_RUNTIME_BASE || 'http://localhost:3300';
const secret = randomBytes(32).toString('hex');
const now = Math.floor(Date.now() / 1000);
const profile = { id: 1, name: 'Review agent', email: 'review@example.invalid', accounts: [{ id: 1, name: 'Review workspace', role: 'administrator' }], account_id: 1 };
const previous = { id: 100, content: 'Thanks', message_type: 1, private: false, created_at: now - 45, sender: { id: 1, name: 'Review agent' }, status: 'sent' };
const conversation = { id: 1, inbox_id: 1, status: 'open', labels: [], unread_count: 0, created_at: now - 90, last_activity_at: now - 45, messages: [previous], meta: { sender: { id: 2, name: 'Review customer' }, assignee: null } };
let multipartPosts = 0;
const receivedFiles = [];
let jsonMessagePosts = 0;
let rejectAttachment = false, rejectedAttachments = 0;
const mock = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost:3301').pathname;
    const json = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (path === '/health') return json({ status: 'ok' });
    if (path === '/api/v1/profile') return json(profile);
    if (path === '/api/v1/accounts/1/inboxes') return json({ payload: [{ id: 1, name: 'Review API', channel_type: 'Channel::Api' }] });
    if (path === '/api/v1/accounts/1/conversations') return json({ data: { payload: [conversation], meta: { all_count: 1 } } });
    if (path === '/api/v1/accounts/1/conversations/1') return json(conversation);
    if (path === '/api/v1/accounts/1/agents') return json([{ ...profile, role: 'administrator' }]);
    if (path === '/api/v1/accounts/1/canned_responses') return json([]);
    if (path === '/api/v1/accounts/1/conversations/1/messages') {
      if (req.method === 'GET') return json({ payload: [previous] });
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      if ((req.headers['content-type'] || '').startsWith('multipart/form-data')) {
        if (rejectAttachment) { rejectedAttachments++; return json({ error: 'Fixture gateway rejected the attachment without storing it.' }, 502); }
        multipartPosts++;
        const form = await new Response(bytes, { headers: { 'content-type': req.headers['content-type'] } }).formData();
        receivedFiles.push(form.get('attachments[]').size);
        return json({ id: 101, content: 'Upload received', message_type: 1 });
      }
      jsonMessagePosts++;
      // Simulate a gateway rejection BEFORE storing the attempted new reply.
      return json({ error: 'Fixture gateway failure; no message was stored.' }, 502);
    }
    return json({});
  } catch (error) { res.writeHead(500); res.end('Fixture failed'); console.error(error.message); }
});
await new Promise(resolve => mock.listen(3301, '127.0.0.1', resolve));
const log = createWriteStream('.local/runtime-regressions.log');
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3300'], {
  env: { ...process.env, SESSION_SECRET: secret, APP_URL: base, ENGINE_URL: 'http://127.0.0.1:3301', NEXT_PUBLIC_ENGINE_URL: 'http://localhost:3301', NEXT_TELEMETRY_DISABLED: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
let browser;
const report = {};
try {
  let ready = false;
  for (let index = 0; index < 100; index++) {
    try { ready = (await fetch(`${base}/login`)).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready, 'Production server did not start');
  const cookie = await sealData({ auth: { 'access-token': 'synthetic-review-token', client: 'synthetic-client', uid: profile.email }, profile, accountId: 1, createdAt: Date.now(), lastSeenAt: Date.now() }, { password: secret, ttl: 86400 });
  const uploads = [];
  for (const { size, chunked = false } of [{ size: 1024 * 1024 }, { size: 12 * 1024 * 1024 }, { size: 20 * 1024 * 1024 }, { size: 20 * 1024 * 1024 + 1 }, { size: 22 * 1024 * 1024, chunked: true }]) {
    const form = new FormData(); form.set('content', 'Regression upload'); form.set('message_type', 'outgoing'); form.set('private', 'false'); form.append('attachments[]', new File([new Uint8Array(size)], 'fixture.bin', { type: 'application/octet-stream' }));
    const encoded = new Request(base, { method: 'POST', body: form });
    const response = await fetch(`${base}/api/workspace/conversations/1/messages`, { method: 'POST', headers: { Cookie: `og_session=${cookie}`, Origin: base, ...(chunked ? { 'Content-Type': encoded.headers.get('content-type') } : {}) }, body: chunked ? encoded.body : form, ...(chunked ? { duplex: 'half' } : {}) });
    const body = await response.json();
    uploads.push({ bytes: size, chunked, status: response.status, response: body });
  }
  report.uploads = { attempts: uploads, multipartPosts, receivedFiles };
  assert.deepEqual(uploads.map(upload => upload.status), [200, 200, 200, 413, 413]);
  assert.deepEqual(receivedFiles, [1024 * 1024, 12 * 1024 * 1024, 20 * 1024 * 1024]);
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  await context.addCookies([{ name: 'og_session', value: cookie, url: base, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  await page.route('**/api/realtime', route => route.fulfill({ status: 503, json: { error: 'No realtime in this fixture' } }));
  await page.goto(`${base}/inbox?conversation=1`);
  const draft = page.getByLabel('Reply to customer');
  await draft.waitFor({ state: 'visible' });
  await draft.fill('Thanks');
  await page.getByRole('button', { name: 'Send reply', exact: true }).click();
  const deliveredNotice = page.getByText('We could not confirm whether this message was saved. Your draft and files are preserved. Check the conversation before retrying.', { exact: true });
  await deliveredNotice.waitFor({ state: 'visible', timeout: 15000 });
  report.failedSend = { jsonMessagePosts, persistedMessageCount: 1, oldMessageId: previous.id, draftAfterFailure: await draft.inputValue(), preservationNoticeVisible: await deliveredNotice.isVisible() };
  await page.screenshot({ path: '.local/runtime-failed-send.png', fullPage: true });
  assert.equal(jsonMessagePosts, 1);
  assert.equal(report.failedSend.draftAfterFailure, 'Thanks');
  await context.close();
  previous.content = null;
  previous.attachments = [{ id: 10, file_type: 'file', data_url: 'http://localhost:3301/old-invoice.txt', file_size: 100, extension: 'txt' }];
  rejectAttachment = true;
  const attachmentContext = await browser.newContext();
  await attachmentContext.addCookies([{ name: 'og_session', value: cookie, url: base, httpOnly: true, sameSite: 'Lax' }]);
  const attachmentPage = await attachmentContext.newPage();
  await attachmentPage.route('**/api/realtime', route => route.fulfill({ status: 503, json: { error: 'No realtime in this fixture' } }));
  await attachmentPage.goto(`${base}/inbox?conversation=1`);
  await attachmentPage.getByLabel('Reply to customer').waitFor({ state: 'visible' });
  await attachmentPage.locator('input[type=file]').setInputFiles({ name: 'completely-new-invoice.txt', mimeType: 'text/plain', buffer: Buffer.from('A different invoice which has never been delivered') });
  await attachmentPage.getByRole('button', { name: 'Send reply', exact: true }).click();
  const attachmentNotice = attachmentPage.getByText('We could not confirm whether this message was saved. Your draft and files are preserved. Check the conversation before retrying.', { exact: true });
  await attachmentNotice.waitFor({ state: 'visible', timeout: 15000 });
  report.failedAttachment = { rejectedAttachments, storedNewAttachments: 0, remainingSelectedFiles: await attachmentPage.locator('.composer-files').count(), preservationNoticeVisible: await attachmentNotice.isVisible() };
  assert.equal(report.failedAttachment.remainingSelectedFiles, 1);
  await attachmentContext.close();
  await writeFile('.local/runtime-regressions-results.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  child.kill('SIGTERM');
  await new Promise(resolve => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); const timeout = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000); timeout.unref(); });
  mock.closeAllConnections();
  await new Promise(resolve => mock.close(resolve));
  log.end();
}
