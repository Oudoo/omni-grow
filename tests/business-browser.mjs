// Real app, PostgreSQL/ActiveStorage and LiveKit. Chromium supplies deterministic
// test cameras/microphones; no business API or SFU is mocked.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, expect as baseExpect } from '@playwright/test';
import { Client } from './business-test-client.mjs';

const expect = baseExpect.configure({ timeout: 15000 });
const fixture = JSON.parse(await readFile('.local/business-test-state.json', 'utf8'));
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true,
  args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--auto-select-screen-capture-source', '--autoplay-policy=no-user-gesture-required'] });
const outcomes = [], errors = [];
const owner = await Client.restore(fixture.users.ownerA.state);
let meeting;
async function check(name, callback) { await callback(); outcomes.push(name); console.log(`PASS ${name}`); }
async function context(who, viewport = { width: 1440, height: 960 }) {
  const result = await browser.newContext({ storageState: fixture.users[who].state, viewport, permissions: ['camera', 'microphone'] });
  // Observe native WebRTC statistics without replacing transports or tracks.
  await result.addInitScript(() => {
    window.__ogPeerConnections = [];
    const Native = window.RTCPeerConnection;
    window.RTCPeerConnection = new Proxy(Native, { construct(target, args) { const pc = Reflect.construct(target, args); window.__ogPeerConnections.push(pc); return pc; } });
  });
  const page = await result.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:3000/team');
  await expect(page.getByRole('heading', { name: 'Your team', exact: true })).toBeVisible();
  return { context: result, page };
}
async function select(page, name = 'Leadership') { await page.locator('.team-room-list .team-room-button').filter({ hasText: name }).first().click(); await expect(page.getByRole('heading', { name, exact: true })).toBeVisible(); }
async function join(page) {
  await page.getByRole('button', { name: /^(Meet|Join meeting)$/ }).click();
  const lobby = page.locator('.lk-prejoin');
  await expect(lobby).toBeVisible();
  await lobby.getByRole('button', { name: 'Camera', exact: true }).click();
  await lobby.getByRole('button', { name: 'Microphone', exact: true }).click();
  await lobby.getByRole('button', { name: 'Join meeting', exact: true }).click();
  await expect(page.locator('.team-meeting-header').getByRole('status')).toHaveText('Connected', { timeout: 45000 });
}
async function media(page) {
  return page.evaluate(async () => {
    const values = [];
    for (const pc of window.__ogPeerConnections || []) for (const stat of (await pc.getStats()).values()) {
      if (stat.type === 'inbound-rtp' && !stat.isRemote) values.push({ kind: stat.kind, bytes: stat.bytesReceived || 0, frames: stat.framesDecoded || 0 });
    }
    return values;
  });
}
try {
  await expect.poll(async () => { try { return (await fetch('http://localhost:3000/api/health')).status; } catch { return 0; } }, { timeout: 90000 }).toBe(200);
  const a = await context('ownerA'), b = await context('memberA');
  await select(a.page); await select(b.page);
  await check('two signed-in employees exchange persisted messages and real file uploads', async () => {
    const text = `Browser acceptance ${randomUUID()}`;
    await a.page.getByLabel('Message your team').fill(text);
    await a.page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(b.page.getByText(text, { exact: true })).toBeVisible({ timeout: 20000 });
    await b.page.reload(); await select(b.page);
    await expect(b.page.getByText(text, { exact: true })).toBeVisible();
    await a.page.getByLabel('Attach files').setInputFiles({ name: 'browser-document.txt', mimeType: 'text/plain', buffer: Buffer.from('Real browser document bytes\n') });
    await a.page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(b.page.getByRole('link', { name: /browser-document.txt/ }).last()).toBeVisible({ timeout: 20000 });
    const [download] = await Promise.all([b.page.waitForEvent('download'), b.page.getByRole('link', { name: /browser-document.txt/ }).last().click()]);
    assert.equal((await readFile(await download.path())).toString(), 'Real browser document bytes\n');
    await a.page.screenshot({ path: '.local/business-desktop.png', fullPage: true });
  });
  await check('reply drafts survive navigation and reload without changing the reply target', async () => {
    await a.page.locator('.team-message').first().getByRole('button', { name: 'Reply', exact: true }).click();
    await a.page.getByLabel('Message your team').fill('Preserved reply draft');
    await select(a.page, 'Company news'); await select(a.page);
    await expect(a.page.getByLabel('Message your team')).toHaveValue('Preserved reply draft');
    await expect(a.page.locator('.team-reply-preview')).toContainText('Replying to');
    await a.page.reload(); await select(a.page);
    await expect(a.page.getByLabel('Message your team')).toHaveValue('Preserved reply draft');
    await expect(a.page.locator('.team-reply-preview')).toContainText('Replying to');
    await a.page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(b.page.getByText('Preserved reply draft', { exact: true }).last()).toBeVisible({ timeout: 20000 });
  });
  await check('private channels are absent for other employees and standalone Team hides the inbox', async () => {
    const outside = await context('outsiderA');
    await expect(outside.page.locator('.team-room-list .team-room-button').filter({ hasText: 'Leadership' })).toHaveCount(0);
    const otherBusiness = await context('ownerB');
    await expect(otherBusiness.page.getByRole('link', { name: 'Shared inbox', exact: true })).toHaveCount(0);
    await expect(otherBusiness.page.locator('.team-room-list .team-room-button').filter({ hasText: 'Leadership' })).toHaveCount(0);
    await outside.context.close(); await otherBusiness.context.close();
  });
  await check('mobile channel navigation, composer and shared documents fit the screen', async () => {
    const mobile = await context('memberA', { width: 390, height: 844 });
    await select(mobile.page);
    await expect(mobile.page.getByLabel('Message your team')).toBeVisible();
    await expect(mobile.page.locator('.team-message').first()).toBeVisible();
    await expect(mobile.page.getByRole('button', { name: 'Send', exact: true })).toBeInViewport();
    assert(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await mobile.page.screenshot({ path: '.local/business-mobile.png', fullPage: true });
    await mobile.page.getByRole('button', { name: 'Back to conversations', exact: true }).click();
    await mobile.page.getByRole('button', { name: 'Shared documents', exact: true }).click();
    await expect(mobile.page.getByRole('heading', { name: 'Team documents', exact: true })).toBeVisible();
    await mobile.context.close();
  });
  await check('two browsers publish and receive real camera and microphone media through LiveKit', async () => {
    await join(a.page);
    meeting = (await owner.call(`/api/business/rooms/${fixture.privateRoom.id}`)).meeting;
    await b.page.reload(); await select(b.page); await join(b.page);
    await expect.poll(async () => (await media(a.page)).some(stat => stat.kind === 'video' && stat.frames > 3), { timeout: 45000 }).toBe(true);
    await expect.poll(async () => (await media(b.page)).some(stat => stat.kind === 'video' && stat.frames > 3), { timeout: 45000 }).toBe(true);
    await expect.poll(async () => (await media(a.page)).some(stat => stat.kind === 'audio' && stat.bytes > 0), { timeout: 30000 }).toBe(true);
    await expect.poll(async () => (await media(b.page)).some(stat => stat.kind === 'audio' && stat.bytes > 0), { timeout: 30000 }).toBe(true);
    await a.page.screenshot({ path: '.local/business-meeting.png', fullPage: true });
  });
  await check('screen sharing publishes a second real video track to the other participant', async () => {
    await a.page.locator('.lk-control-bar button[data-lk-source="screen_share"]').click();
    await expect.poll(async () => (await media(b.page)).filter(stat => stat.kind === 'video' && stat.frames > 3).length, { timeout: 30000 }).toBeGreaterThanOrEqual(2);
  });
  await check('removing a private-channel participant disconnects every existing meeting session', async () => {
    await owner.call(`/api/business/rooms/${fixture.privateRoom.id}`, 'PATCH', { member_ids: [] });
    await expect(a.page.locator('.team-meeting-header').getByRole('status')).not.toHaveText('Connected', { timeout: 20000 });
    await expect(b.page.locator('.team-meeting-header').getByRole('status')).not.toHaveText('Connected', { timeout: 20000 });
    const member = await Client.restore(fixture.users.memberA.state);
    await member.call(`/api/business/rooms/${fixture.privateRoom.id}/meetings/${meeting.id}/join`, 'POST', {}, 404);
    await owner.call(`/api/business/rooms/${fixture.privateRoom.id}`, 'PATCH', { member_ids: [fixture.users.memberA.profile.id] });
    meeting = undefined;
  });
  assert.deepEqual(errors, [], 'The app must not raise browser runtime errors.');
  console.log(`Passed ${outcomes.length} real browser/media checks.`);
} finally {
  if (meeting) await owner.call(`/api/business/rooms/${fixture.privateRoom.id}/meetings/${meeting.id}`, 'DELETE').catch(() => {});
  await writeFile('.local/business-browser-results.json', JSON.stringify({ passed: outcomes.length, checks: outcomes, browserErrors: errors }, null, 2));
  await browser.close();
}
