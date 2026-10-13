import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { openRealtime, closeRealtimeStreams } from '../realtime-helper';
import { readFile, writeFile } from 'node:fs/promises';
import { loadEnvConfig } from '@next/env';

interface Fixture { switch_account_id: number; accounts: { id: number; inbox_id: number; api_inbox_id: number; website_token: string; identifier: string }[]; users: { id: number; email: string; password: string }[]; agent: { id: number; email: string; password: string }; mfa: { id: number; email: string; password: string; backup_code: string } }
let fixture: Fixture, apiA: APIRequestContext, apiB: APIRequestContext, apiAgent: APIRequestContext;
const base = 'http://localhost:3000', engine = 'http://localhost:3001';
test.beforeAll(async ({ playwright }) => {
  test.setTimeout(420000);
  fixture = JSON.parse(await readFile('.local/test-fixture.json', 'utf8'));
  const clients = [];
  for (const [index, credentials] of [fixture.users[0], fixture.users[1], fixture.agent].entries()) {
    const saved = `.local/test-session-${index}.json`;
    let storageState;
    try { storageState = JSON.parse(await readFile(saved, 'utf8')); } catch {}
    const client = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base }, storageState });
    if (!storageState) {
      let response = await client.post('/api/auth/login', { data: { email: credentials.email, password: credentials.password } });
      if (response.status() === 429) {
        console.log('Native authentication throttle reached; honoring Retry-After before retrying.');
        await new Promise(resolve => setTimeout(resolve, (Number(response.headers()['retry-after']) || 300) * 1000 + 1000));
        response = await client.post('/api/auth/login', { data: { email: credentials.email, password: credentials.password } });
      }
      expect(response.status()).toBe(200);
      expect(await response.json()).not.toHaveProperty('access_token');
      await writeFile(saved, JSON.stringify(await client.storageState()), { mode: 0o600 });
    }
    clients.push(client);
  }
  [apiA, apiB, apiAgent] = clients;
});
test.afterEach(() => closeRealtimeStreams());
test.afterAll(async () => { await Promise.all([apiA?.dispose(), apiB?.dispose(), apiAgent?.dispose()]); });
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(fixture.users[0].email);
  await page.getByLabel('Password', { exact: true }).fill(fixture.users[0].password);
  await page.getByRole('button', { name: 'Sign in to your workspace' }).click();
  await expect(page).toHaveURL(/\/inbox$/);
}
async function useExistingSession(page: Page) {
  const state = await apiA.storageState();
  await page.context().addCookies(state.cookies);
  await page.goto('/inbox');
}

test('protects anonymous requests, cross-site writes, tenant IDs, and administrator actions', async ({ request }) => {
  expect((await request.get('/api/workspace/conversations')).status()).toBe(401);
  expect((await request.get('/api/realtime')).status()).toBe(401);
  expect((await request.post('/api/auth/login', { data: { email: 'invalid@example.com', password: 'invalid' }, headers: { Origin: 'https://evil.example' } })).status()).toBe(403);
  expect((await apiA.post('/api/auth/account', { data: { accountId: fixture.accounts[1].id } })).status()).toBe(403);
  expect((await apiA.get(`/api/workspace/inboxes/${fixture.accounts[1].inbox_id}`)).status()).toBe(404);
  expect((await apiA.get(`/api/workspace/accounts/${fixture.accounts[1].id}/conversations`)).status()).toBe(404);
  expect((await apiAgent.post('/api/workspace/inboxes', { data: { name: 'denied', channel: { type: 'api' } } })).status()).toBe(403);
  const list = await apiAgent.get('/api/workspace/inboxes'); expect(list.ok()).toBeTruthy();
  expect((await list.json()).payload).toEqual([]);
  const crossSite = await apiA.post('/api/workspace/contacts', { headers: { Origin: 'https://evil.example' }, data: { name: 'denied' } }); expect(crossSite.status()).toBe(403);
});

test('exchanges real API-channel messages and keeps notes and other tenants private', async ({ playwright }) => {
  const tenantBStream = await openRealtime(apiB);
  const customer = await playwright.request.newContext({ baseURL: engine });
  const account = fixture.accounts[0];
  const created = await customer.post(`/public/api/v1/inboxes/${account.identifier}/contacts`, { data: { name: 'Integration customer', email: 'customer@og-tests.local' } });
  expect(created.ok()).toBeTruthy(); const contact = await created.json();
  expect(contact.source_id).toBeTruthy();
  const root = `/public/api/v1/inboxes/${account.identifier}/contacts/${contact.source_id}/conversations`;
  const conversation = await customer.post(root, { data: {} }); expect(conversation.ok()).toBeTruthy(); const thread = await conversation.json();
  const incoming = await customer.post(`${root}/${thread.id}/messages`, { data: { content: 'A real inbound integration message' } }); expect(incoming.ok()).toBeTruthy();
  const messages = await apiA.get(`/api/workspace/conversations/${thread.id}/messages`); expect(messages.ok()).toBeTruthy(); expect(JSON.stringify(await messages.json())).toContain('A real inbound integration message');
  expect((await apiB.get(`/api/workspace/conversations/${thread.id}/messages`)).status()).toBe(404);
  expect((await apiB.post(`/api/workspace/conversations/${thread.id}/messages`, { data: { content: 'denied', message_type: 'outgoing' } })).status()).toBe(404);
  const reply = await apiA.post(`/api/workspace/conversations/${thread.id}/messages`, { data: { content: 'A real agent response', message_type: 'outgoing', private: false } }); expect(reply.ok()).toBeTruthy();
  const note = await apiA.post(`/api/workspace/conversations/${thread.id}/messages`, { data: { content: 'This is private team context', message_type: 'outgoing', private: true } }); expect(note.ok()).toBeTruthy();
  const customerMessages = await customer.get(`${root}/${thread.id}/messages`); expect(customerMessages.ok()).toBeTruthy(); const history = JSON.stringify(await customerMessages.json());
  expect(history).toContain('A real agent response'); expect(history).not.toContain('This is private team context');
  const state = await apiA.post(`/api/workspace/conversations/${thread.id}/toggle_status`, { data: { status: 'resolved' } }); expect(state.ok()).toBeTruthy();
  expect((await (await apiA.get(`/api/workspace/conversations/${thread.id}`)).json()).status).toBe('resolved');
  const tenantB = fixture.accounts[1];
  const bContactResponse = await customer.post(`/public/api/v1/inboxes/${tenantB.identifier}/contacts`, { data: { name: 'Tenant B visitor' } });
  expect(bContactResponse.ok()).toBeTruthy(); const bContact = await bContactResponse.json();
  const bRoot = `/public/api/v1/inboxes/${tenantB.identifier}/contacts/${bContact.source_id}/conversations`;
  const bConversationResponse = await customer.post(bRoot, { data: {} });
  expect(bConversationResponse.ok()).toBeTruthy(); const bConversation = await bConversationResponse.json();
  expect((await customer.post(`${bRoot}/${bConversation.id}/messages`, { data: { content: 'Only tenant B can receive this event' } })).ok()).toBeTruthy();
  await expect.poll(() => JSON.stringify(tenantBStream.frames)).toContain('Only tenant B can receive this event');
  expect(JSON.stringify(tenantBStream.frames)).not.toContain('A real inbound integration message');
  expect(JSON.stringify(tenantBStream.frames)).not.toContain('This is private team context');
  expect(JSON.stringify(tenantBStream.frames)).not.toContain('pubsub_token');
  await customer.dispose();
});

test('runs the actual website widget, receives a reply, and preserves history after reload', async ({ page, browser }) => {
  await login(page);
  await expect(page.getByText('Live updates')).toBeVisible();
  const visitorContext = await browser.newContext(); const visitor = await visitorContext.newPage();
  await visitor.goto(`/demo?token=${fixture.accounts[0].website_token}`);
  await expect(visitor.getByRole('button', { name: 'Open chat window' })).toBeVisible();
  await visitor.getByRole('button', { name: 'Open chat window' }).click();
  const widget = visitor.frameLocator('#chatwoot_live_chat_widget');
  await widget.getByText('Start Conversation', { exact: true }).click();
  await expect(widget.locator('textarea')).toBeVisible();
  await widget.locator('textarea').fill('Hello from the real website widget');
  await widget.locator('textarea').press('Enter');
  await expect(page.locator('.conversation-item')).toHaveCount(1);
  await page.locator('.conversation-item').click();
  await expect(page.locator('.message-bubble').filter({ hasText: 'Hello from the real website widget' })).toBeVisible();
  let releaseReply!: () => void;
  const replyResponseReleased = new Promise<void>(resolve => { releaseReply = resolve; });
  // Send through the real engine, but delay its HTTP acknowledgement to exercise draft preservation.
  await page.route('**/api/workspace/conversations/*/messages', async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON()?.content === 'Hello back from OmniGrow') {
      const response = await route.fetch();
      await replyResponseReleased;
      await route.fulfill({ response });
    } else await route.continue();
  });
  await page.getByLabel('Reply to customer').fill('Hello back from OmniGrow');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(widget.getByText('Hello back from OmniGrow', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Internal note', exact: true }).click();
  await page.getByLabel('Internal note', { exact: true }).fill('Website visitor must never see this note');
  releaseReply();
  await expect(page.getByRole('button', { name: 'Add note' })).toBeEnabled();
  await expect(page.getByLabel('Internal note', { exact: true })).toHaveValue('Website visitor must never see this note');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.locator('.private-note .message-bubble').filter({ hasText: 'Website visitor must never see this note' })).toBeVisible();
  await expect(page.getByLabel('Internal note', { exact: true })).toHaveValue('');
  await expect(widget.getByText('Website visitor must never see this note')).toHaveCount(0);
  await page.screenshot({ path: '.local/verified-inbox.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Back to conversations' }).click();
  await expect(page.getByRole('region', { name: 'Conversations', exact: true })).toBeVisible();
  await page.getByLabel('Conversation status').selectOption('all');
  await expect(page.locator('.conversation-item')).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Conversations', exact: true })).toBeVisible();
  await visitor.reload(); await visitor.getByRole('button', { name: 'Open chat window' }).click();
  // After a reload the native widget shows either its home screen or, when agent replies arrived unread, the conversation itself.
  const reopened = visitor.frameLocator('#chatwoot_live_chat_widget');
  const continueConversation = reopened.getByText('Continue conversation', { exact: true });
  if (await continueConversation.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)) await continueConversation.click();
  await expect(reopened.getByText('Hello back from OmniGrow', { exact: true })).toBeVisible();
  await visitorContext.close();
});

test('creates real saved replies and executes an automation rule through the interface', async ({ page, playwright }) => {
  await useExistingSession(page); await page.getByRole('link', { name: 'Automations', exact: true }).click();
  await page.getByRole('button', { name: 'Saved replies', exact: true }).click(); await page.getByRole('button', { name: 'Add saved reply' }).click();
  await page.getByLabel('Shortcut (without the slash)').fill('integration'); await page.getByLabel('Reply text').fill('A saved response from the real database');
  await page.getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.getByText('/integration', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Automation rules', exact: true }).click(); await page.getByRole('button', { name: 'Create rule', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Integration welcome'); await page.getByLabel('Welcome message').fill('An automated welcome from OmniGrow');
  await page.getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.getByText('Integration welcome', { exact: true })).toBeVisible();
  const customer = await playwright.request.newContext({ baseURL: engine });
  const created = await customer.post(`/public/api/v1/inboxes/${fixture.accounts[0].identifier}/contacts`, { data: { name: 'Automation visitor' } });
  expect(created.ok()).toBeTruthy();
  const contact = await created.json();
  const conversationsPath = `/public/api/v1/inboxes/${fixture.accounts[0].identifier}/contacts/${contact.source_id}/conversations`;
  const started = await customer.post(conversationsPath, { data: {} });
  expect(started.ok()).toBeTruthy(); const conversation = await started.json();
  await expect.poll(async () => JSON.stringify(await (await customer.get(`${conversationsPath}/${conversation.id}/messages`)).json())).toContain('An automated welcome from OmniGrow');
  await customer.dispose();
  await page.getByRole('switch', { name: 'Enable Integration welcome' }).click(); await expect(page.getByRole('switch', { name: 'Enable Integration welcome' })).toHaveAttribute('aria-checked', 'false');
});

test('creates a real contact and displays actual report metrics', async ({ page }) => {
  await useExistingSession(page); await page.getByRole('link', { name: 'Contacts', exact: true }).click(); await page.getByRole('button', { name: 'Add contact' }).click();
  await page.getByLabel('Full name').fill('Integration contact'); await page.getByLabel('Email address').fill('contact@og-tests.local');
  await page.getByRole('button', { name: 'Save contact' }).click(); await expect(page.getByText('Integration contact', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Reports', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Every reply matters.' })).toBeVisible();
  await expect(page.locator('.metric-card').first().locator('strong')).not.toHaveText('—');
  await page.screenshot({ path: '.local/verified-reports.png', fullPage: true });
});

test('saves a webhook, assigns a bot, and removes an agent from inbox membership', async ({ page }) => {
  const inboxId = fixture.accounts[0].inbox_id;
  const createdBot = await apiA.post('/api/workspace/agent_bots', { data: { name: 'Integration bot', outgoing_url: 'https://bot.omnigrow.invalid/events' } });
  expect(createdBot.ok()).toBeTruthy();
  const bot = await createdBot.json(); expect(bot).not.toHaveProperty('access_token');
  expect((await apiA.post('/api/workspace/inbox_members', { data: { inbox_id: inboxId, user_ids: [fixture.agent.id] } })).ok()).toBeTruthy();
  expect((await apiAgent.get(`/api/workspace/inboxes/${inboxId}`)).ok()).toBeTruthy();
  await useExistingSession(page);
  await page.getByRole('link', { name: 'Channels', exact: true }).click();
  await page.getByRole('button', { name: 'Settings for Integration website A', exact: true }).click();
  await page.getByLabel('Restricted agent', { exact: true }).uncheck();
  await page.getByLabel('Agent bot', { exact: true }).selectOption(String(bot.id));
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect([401, 403, 404]).toContain((await apiAgent.get(`/api/workspace/inboxes/${inboxId}`)).status());
  const assignedBot = await apiA.get(`/api/workspace/inboxes/${inboxId}/agent_bot`);
  expect((await assignedBot.json()).agent_bot.id).toBe(bot.id);
  expect((await apiA.post(`/api/workspace/inboxes/${inboxId}/set_agent_bot`, { data: { agent_bot: null } })).ok()).toBeTruthy();
  expect((await apiA.delete(`/api/workspace/agent_bots/${bot.id}`, { data: {} })).ok()).toBeTruthy();
  const remaining = await apiAgent.get('/api/workspace/inboxes');
  expect(remaining.ok()).toBeTruthy(); expect((await remaining.json()).payload).toEqual([]);
  await page.getByRole('link', { name: 'Workspace settings', exact: true }).click();
  await page.getByRole('button', { name: 'Webhooks', exact: true }).click();
  await page.getByRole('button', { name: 'Add webhook', exact: true }).click();
  await page.getByLabel('Event endpoint').fill('https://webhook.omnigrow.invalid/events');
  await page.getByRole('dialog').getByRole('button', { name: 'Add webhook', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('https://webhook.omnigrow.invalid/events', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Delete webhook/ }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText('https://webhook.omnigrow.invalid/events', { exact: true })).toHaveCount(0);
});

test('offers real SMS and LINE channel configuration without exposing credentials', async ({ page }) => {
  await useExistingSession(page); await page.getByRole('link', { name: 'Channels', exact: true }).click();
  await page.getByRole('button', { name: 'Connect SMS', exact: true }).click();
  await expect(page.getByLabel('Twilio auth token')).toHaveAttribute('type', 'password');
  await expect(page.getByLabel('Twilio account SID')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Connect LINE', exact: true }).click();
  await expect(page.getByLabel('LINE channel secret')).toHaveAttribute('type', 'password');
  await expect(page.getByLabel('LINE channel access token')).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  // The Meta app secret is required so the engine verifies every WhatsApp webhook signature.
  await page.getByRole('button', { name: 'Connect WhatsApp', exact: true }).click();
  await expect(page.getByLabel('Meta app secret')).toHaveAttribute('type', 'password');
  await expect(page.getByLabel('Meta app secret')).toHaveAttribute('required', '');
  await expect(page.getByLabel('Permanent access token')).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await apiAgent.post('/api/workspace/channels/twilio_channel', { data: {} })).status()).toBe(403);
});

async function localConversation(playwright: { request: { newContext: (options: { baseURL: string }) => Promise<APIRequestContext> } }, name: string) {
  const customer = await playwright.request.newContext({ baseURL: engine });
  const inbox = fixture.accounts[0];
  const contact = await (await customer.post(`/public/api/v1/inboxes/${inbox.identifier}/contacts`, { data: { name } })).json();
  const root = `/public/api/v1/inboxes/${inbox.identifier}/contacts/${contact.source_id}/conversations`;
  const conversation = await (await customer.post(root, { data: {} })).json();
  const path = `${root}/${conversation.id}/messages`;
  expect((await customer.post(path, { data: { content: `Hello from ${name}` } })).ok()).toBeTruthy();
  return { customer, path, id: conversation.id as number };
}

test('local quality: filters conversations assigned to the current agent', async ({ page, playwright }) => {
  const mine = await localConversation(playwright, 'Assigned local customer');
  const other = await localConversation(playwright, 'Unassigned local customer');
  try {
    expect((await apiA.post(`/api/workspace/conversations/${mine.id}/assignments`, { data: { assignee_id: fixture.users[0].id } })).ok()).toBeTruthy();
    expect((await apiA.post(`/api/workspace/conversations/${other.id}/assignments`, { data: { assignee_id: null } })).ok()).toBeTruthy();
    await useExistingSession(page);
    await page.getByRole('button', { name: 'Assigned to me', exact: true }).click();
    await expect(page.locator('.conversation-item').filter({ has: page.getByText('Assigned local customer', { exact: true }) })).toBeVisible();
    await expect(page.locator('.conversation-item').filter({ has: page.getByText('Unassigned local customer', { exact: true }) })).toHaveCount(0);
  } finally { await mine.customer.dispose(); await other.customer.dispose(); }
});

test('local quality: keeps separate reply and private drafts through navigation', async ({ page, playwright }) => {
  const a = await localConversation(playwright, 'Draft customer A');
  const b = await localConversation(playwright, 'Draft customer B');
  try {
    await useExistingSession(page);
    await page.locator('.conversation-item').filter({ hasText: 'Draft customer A' }).click();
    await page.getByLabel('Reply to customer').fill('Unsent reply for A');
    await page.locator('input[type=file]').setInputFiles({ name: 'public-draft.txt', mimeType: 'text/plain', buffer: Buffer.from('Public attachment') });
    await page.getByRole('button', { name: 'Internal note', exact: true }).click();
    await expect(page.getByLabel('Internal note', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Remove public-draft.txt')).toHaveCount(0);
    await page.getByLabel('Internal note', { exact: true }).fill('Private draft for A');
    await page.locator('input[type=file]').setInputFiles({ name: 'private-draft.txt', mimeType: 'text/plain', buffer: Buffer.from('Private attachment') });
    await page.getByRole('button', { name: 'Reply', exact: true }).click();
    await expect(page.getByLabel('Reply to customer')).toHaveValue('Unsent reply for A');
    await expect(page.getByLabel('Remove public-draft.txt')).toBeVisible();
    await expect(page.getByLabel('Remove private-draft.txt')).toHaveCount(0);
    await page.locator('.conversation-item').filter({ hasText: 'Draft customer B' }).click();
    await expect(page.getByLabel('Reply to customer')).toHaveValue('');
    await page.locator('.conversation-item').filter({ hasText: 'Draft customer A' }).click();
    await expect(page.getByLabel('Reply to customer')).toHaveValue('Unsent reply for A');
    await expect(page.getByLabel('Remove public-draft.txt')).toBeVisible();
    await page.getByRole('link', { name: 'Contacts', exact: true }).click();
    await page.getByRole('link', { name: 'Shared inbox', exact: true }).click();
    await page.locator('.conversation-item').filter({ hasText: 'Draft customer A' }).click();
    await expect(page.getByLabel('Reply to customer')).toHaveValue('Unsent reply for A');
    await page.reload();
    await page.locator('.conversation-item').filter({ hasText: 'Draft customer A' }).click();
    await expect(page.getByLabel('Reply to customer')).toHaveValue('Unsent reply for A');
    await expect(page.getByRole('button', { name: 'Send reply' })).toBeDisabled();
    await expect(page.getByText('Choose these files again')).toBeVisible();
  } finally { await a.customer.dispose(); await b.customer.dispose(); }
});

test('local quality: filters live events to the selected workspace of a shared user', async ({ playwright }) => {
  const conversation = await localConversation(playwright, 'Shared-user account isolation');
  try {
    expect((await apiA.post('/api/auth/account', { data: { accountId: fixture.switch_account_id } })).ok()).toBeTruthy();
    const stream = await openRealtime(apiA);
    expect((await conversation.customer.post(conversation.path, { data: { content: 'PRIVATE OTHER WORKSPACE EVENT' } })).ok()).toBeTruthy();
    expect((await apiA.post('/api/workspace/contacts', { data: { name: 'Selected workspace visible event' } })).ok()).toBeTruthy();
    await expect.poll(() => JSON.stringify(stream.frames)).toContain('Selected workspace visible event');
    expect(JSON.stringify(stream.frames)).not.toContain('PRIVATE OTHER WORKSPACE EVENT');
  } finally {
    expect((await apiA.post('/api/auth/account', { data: { accountId: fixture.accounts[0].id } })).ok()).toBeTruthy();
    await conversation.customer.dispose();
  }
});

test('local quality: keeps message history continuous and marks new visible messages read', async ({ page, playwright }) => {
  const conversation = await localConversation(playwright, 'History local customer');
  try {
    for (let index = 1; index <= 30; index++) {
      expect((await conversation.customer.post(conversation.path, { data: { content: `History item ${index.toString().padStart(2, '0')}` } })).ok()).toBeTruthy();
    }
    await useExistingSession(page);
    await page.locator('.conversation-item').filter({ hasText: 'History local customer' }).click();
    await expect(page.locator('.message-scroll').getByText('History item 30', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Load earlier messages' }).click();
    await expect(page.locator('.message-scroll').getByText('History item 01', { exact: true })).toHaveCount(1);
    await page.locator('.message-scroll').evaluate(element => { element.scrollTop = 0; });
    await expect.poll(() => page.locator('.message-scroll').evaluate(element => element.scrollTop)).toBe(0);
    expect((await conversation.customer.post(conversation.path, { data: { content: 'New message while reading earlier history' } })).ok()).toBeTruthy();
    await expect(page.getByRole('button', { name: 'New messages', exact: true })).toBeVisible();
    await expect.poll(() => page.locator('.message-scroll').evaluate(element => element.scrollTop)).toBe(0);
    for (let index = 1; index <= 30; index++) await expect(page.locator('.message-scroll').getByText(`History item ${index.toString().padStart(2, '0')}`, { exact: true })).toHaveCount(1);
    await expect.poll(async () => (await (await apiA.get(`/api/workspace/conversations/${conversation.id}`)).json()).unread_count).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'New messages', exact: true }).click();
    await expect(page.locator('.message-scroll').getByText('New message while reading earlier history', { exact: true })).toBeVisible();
    await expect.poll(async () => (await (await apiA.get(`/api/workspace/conversations/${conversation.id}`)).json()).unread_count).toBe(0);
    expect((await conversation.customer.post(conversation.path, { data: { content: 'New message while at the bottom' } })).ok()).toBeTruthy();
    await expect(page.locator('.message-scroll').getByText('New message while at the bottom', { exact: true })).toBeVisible();
    await expect.poll(async () => (await (await apiA.get(`/api/workspace/conversations/${conversation.id}`)).json()).unread_count).toBe(0);
    // Real writes continue while the browser cannot refresh its latest-message page.
    await page.route(`**/api/workspace/conversations/${conversation.id}/messages*`, route => route.request().method() === 'GET' ? route.abort('connectionfailed') : route.continue());
    for (let index = 1; index <= 25; index++) expect((await conversation.customer.post(conversation.path, { data: { content: `Disconnected burst ${index}` } })).ok()).toBeTruthy();
    await page.unroute(`**/api/workspace/conversations/${conversation.id}/messages*`);
    expect((await conversation.customer.post(conversation.path, { data: { content: 'Reconnected after the burst' } })).ok()).toBeTruthy();
    await expect(page.locator('.message-scroll').getByText('Reconnected after the burst', { exact: true })).toBeVisible();
    for (let index = 1; index <= 25; index++) await expect(page.locator('.message-scroll').getByText(`Disconnected burst ${index}`, { exact: true })).toHaveCount(1);
    await page.getByRole('link', { name: 'Contacts', exact: true }).click();
    for (let index = 1; index <= 25; index++) expect((await conversation.customer.post(conversation.path, { data: { content: `Navigation burst ${index}` } })).ok()).toBeTruthy();
    await page.getByRole('link', { name: 'Shared inbox', exact: true }).click();
    await page.locator('.conversation-item').filter({ hasText: 'History local customer' }).click();
    for (let index = 1; index <= 25; index++) await expect(page.locator('.message-scroll').getByText(`Navigation burst ${index}`, { exact: true })).toHaveCount(1);
  } finally { await conversation.customer.dispose(); }
});

test('local quality: keeps an in-flight reply locked across conversation navigation', async ({ page, playwright }) => {
  const a = await localConversation(playwright, 'Sending local customer A');
  const b = await localConversation(playwright, 'Sending local customer B');
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let posts = 0;
  try {
    await useExistingSession(page);
    await page.locator('.conversation-item').filter({ hasText: 'Sending local customer A' }).click();
    await page.route(`**/api/workspace/conversations/${a.id}/messages`, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      posts++;
      const response = await route.fetch();
      await pending;
      await route.fulfill({ response });
    });
    await page.getByLabel('Reply to customer').fill('Send this exactly once during navigation');
    await page.getByRole('button', { name: 'Send reply', exact: true }).click();
    await expect.poll(() => posts).toBe(1);
    await page.locator('.conversation-item').filter({ hasText: 'Sending local customer B' }).click();
    await page.locator('.conversation-item').filter({ hasText: 'Sending local customer A' }).click();
    await expect(page.getByRole('button', { name: 'Sending…', exact: true })).toBeDisabled();
    await page.getByLabel('Reply to customer').fill('Next reply written before acknowledgment');
    release();
    await expect(page.getByRole('button', { name: 'Send reply', exact: true })).toBeEnabled();
    await expect(page.getByLabel('Reply to customer')).toHaveValue('Next reply written before acknowledgment');
    expect(posts).toBe(1);
    const history = await (await apiA.get(`/api/workspace/conversations/${a.id}/messages`)).json();
    expect(history.payload.filter((message: { content: string }) => message.content === 'Send this exactly once during navigation')).toHaveLength(1);
  } finally { release(); await a.customer.dispose(); await b.customer.dispose(); }
});

test('local quality: sends real attachments and keeps private attachments out of customer history', async ({ page, playwright }) => {
  const conversation = await localConversation(playwright, 'Attachment local customer');
  try {
    await useExistingSession(page);
    await page.locator('.conversation-item').filter({ hasText: 'Attachment local customer' }).click();
    await page.getByLabel('Reply to customer').fill('Your requested document');
    await page.locator('input[type=file]').setInputFiles({ name: 'customer-document.txt', mimeType: 'text/plain', buffer: Buffer.from('Verified public attachment bytes') });
    await page.getByRole('button', { name: 'Send reply', exact: true }).click();
    await expect(page.getByLabel('Reply to customer')).toHaveValue('');
    let publicMessage: { attachments: { data_url: string }[] } | undefined;
    await expect.poll(async () => {
      const response = await conversation.customer.get(conversation.path);
      const body = await response.json();
      const messages = Array.isArray(body) ? body : body.payload;
      publicMessage = messages.find((item: { content: string }) => item.content === 'Your requested document');
      return publicMessage?.attachments?.length || 0;
    }).toBe(1);
    const attachment = await conversation.customer.get(publicMessage!.attachments[0].data_url);
    expect(attachment.ok()).toBeTruthy(); expect(await attachment.text()).toBe('Verified public attachment bytes');
    await page.getByRole('button', { name: 'Internal note', exact: true }).click();
    await page.getByLabel('Internal note', { exact: true }).fill('Private attachment context');
    await page.locator('input[type=file]').setInputFiles({ name: 'internal-document.txt', mimeType: 'text/plain', buffer: Buffer.from('Private team attachment bytes') });
    await page.getByRole('button', { name: 'Add note', exact: true }).click();
    await expect(page.getByLabel('Internal note', { exact: true })).toHaveValue('');
    await expect(page.locator('.private-note .attachment')).toHaveCount(1);
    const customerHistory = JSON.stringify(await (await conversation.customer.get(conversation.path)).json());
    expect(customerHistory).not.toContain('Private attachment context');
    expect(customerHistory).not.toContain('internal-document');
  } finally { await conversation.customer.dispose(); }
});

test('local quality: provides mobile controls, pending handoff, and recovery from a missing conversation', async ({ page, playwright }) => {
  const conversation = await localConversation(playwright, 'Mobile local customer');
  try {
    expect((await apiA.post(`/api/workspace/conversations/${conversation.id}/toggle_status`, { data: { status: 'pending' } })).ok()).toBeTruthy();
    await page.setViewportSize({ width: 390, height: 844 });
    await useExistingSession(page);
    await page.getByLabel('Conversation status').selectOption('pending');
    await page.locator('.conversation-item').filter({ hasText: 'Mobile local customer' }).click();
    await page.getByRole('button', { name: 'Take over', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Resolve', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Conversation details', exact: true }).click();
    await page.route(`**/api/workspace/conversations/${conversation.id}/assignments`, route => route.abort('connectionfailed'));
    await page.getByLabel('Assigned agent').selectOption(String(fixture.users[0].id));
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
    await page.unroute(`**/api/workspace/conversations/${conversation.id}/assignments`);
    await page.getByLabel('Assigned agent').selectOption(String(fixture.users[0].id));
    await expect(page.getByLabel('Conversation priority')).toBeEnabled();
    await page.getByLabel('Conversation priority').selectOption('high');
    await expect.poll(async () => (await (await apiA.get(`/api/workspace/conversations/${conversation.id}`)).json()).priority).toBe('high');
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.screenshot({ path: '.local/verified-mobile-inbox.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await page.getByRole('button', { name: 'Account menu' }).click();
    await expect(page.getByRole('button', { name: 'Sign out of OmniGrow', exact: true })).toBeVisible();
    await page.getByLabel('Switch workspace').selectOption(String(fixture.switch_account_id));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Switching reloads the workspace. A click that lands before React hydrates is lost, so retry until the menu opens.
    await expect(async () => {
      await page.getByRole('button', { name: 'Account menu' }).click();
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await expect(page.getByLabel('Switch workspace')).toHaveValue(String(fixture.switch_account_id));
    await page.getByLabel('Switch workspace').selectOption(String(fixture.accounts[0].id));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.goto('/inbox?conversation=2147483647');
    await expect(page.getByText('Conversation unavailable', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back to conversations', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Conversations', exact: true })).toBeVisible();
  } finally { await conversation.customer.dispose(); }
});

test('local quality: protects an in-flight contact save and opens its conversation history', async ({ page, playwright }) => {
  const conversation = await localConversation(playwright, 'Contact history customer');
  try {
    await useExistingSession(page);
    await page.getByRole('link', { name: 'Contacts', exact: true }).click();
    await page.getByRole('button', { name: 'Add contact', exact: true }).click();
    await page.getByLabel('Full name', { exact: true }).fill('Pending save customer');
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/workspace/contacts', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch();
      await pending;
      await route.fulfill({ response });
    });
    await page.getByRole('button', { name: 'Save contact', exact: true }).click();
    try {
      await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Close dialog', exact: true })).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeVisible();
    } finally { release(); }
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByLabel('Search contacts').fill('Contact history customer');
    await page.getByRole('row').filter({ hasText: 'Contact history customer' }).getByRole('button', { name: 'View details' }).click();
    await page.getByRole('link', { name: `Conversation #${conversation.id}` }).click();
    await expect(page.getByRole('region', { name: 'Conversation with Contact history customer', exact: true })).toBeVisible();
  } finally { await conversation.customer.dispose(); }
});

test('local quality: creates a website channel and exposes its real widget test', async ({ page }) => {
  await useExistingSession(page);
  await page.getByRole('link', { name: 'Channels', exact: true }).click();
  await page.getByRole('button', { name: 'Connect website', exact: true }).click();
  await page.getByLabel('Inbox name', { exact: true }).fill('Local acceptance website');
  await page.getByLabel('Your website URL').fill('http://localhost:3000');
  await page.getByRole('button', { name: 'Connect channel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const channel = page.locator('.connected-channel').filter({ hasText: 'Local acceptance website' });
  await expect(channel).toBeVisible();
  await channel.getByRole('button', { name: 'Install widget' }).click();
  await expect(page.getByRole('link', { name: 'Test real widget' })).toHaveAttribute('href', /^\/demo\?token=.+/);
  await expect(page.locator('.code-block')).toContainText('chatwootSDK.run');
});

for (const attachment of [false, true]) {
  test(`confirms the exact stored ${attachment ? 'attachment note' : 'text reply'} when its HTTP acknowledgement is lost`, async ({ page, playwright }) => {
    const conversation = await localConversation(playwright, `Interrupted ${attachment ? 'attachment' : 'reply'} customer`);
    const path = `/api/workspace/conversations/${conversation.id}/messages`;
    let posts = 0, storedId = 0, attempt = '';
    try {
      expect((await apiA.post(path, { data: { content: 'Repeated reply', message_type: 'outgoing', private: false } })).ok()).toBeTruthy();
      await useExistingSession(page);
      await page.goto(`/inbox?conversation=${conversation.id}`);
      await expect(page.getByLabel('Reply to customer')).toBeVisible();
      await page.route(`**${path}`, async route => {
        if (route.request().method() !== 'POST') return route.continue();
        posts++;
        const response = await route.fetch();
        expect(response.ok()).toBeTruthy();
        const stored = await response.json();
        storedId = stored.id; attempt = stored.content_attributes?.omnigrow_client_id;
        // The real database committed the message; only the HTTP acknowledgement is lost.
        await route.fulfill({ status: 502, json: { error: 'Synthetic lost acknowledgement' } });
      });
      if (attachment) {
        await page.getByRole('button', { name: 'Internal note', exact: true }).click();
        await page.locator('input[type=file]').setInputFiles({ name: 'acknowledged.txt', mimeType: 'text/plain', buffer: Buffer.from('Persisted despite lost acknowledgement') });
        await page.getByRole('button', { name: 'Add note', exact: true }).click();
      } else {
        await page.getByLabel('Reply to customer').fill('Repeated reply');
        await page.getByRole('button', { name: 'Send reply', exact: true }).click();
      }
      await expect(page.getByText('Your message was saved even though the connection was interrupted. Check its status for delivery.', { exact: true })).toBeVisible();
      await expect(page.getByLabel(attachment ? 'Internal note' : 'Reply to customer', { exact: true })).toHaveValue('');
      await expect(page.getByLabel('Remove acknowledged.txt')).toHaveCount(0);
      expect(posts).toBe(1);
      expect(attempt).toMatch(/^[a-f0-9-]{36}$/);
      const history = (await (await apiA.get(`${path}?after=0`)).json()).payload;
      const matches = history.filter((message: { content_attributes?: { omnigrow_client_id?: string } }) => message.content_attributes?.omnigrow_client_id === attempt);
      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe(storedId);
      expect(matches[0].private).toBe(attachment);
      if (attachment) {
        const file = await conversation.customer.get(matches[0].attachments[0].data_url);
        expect(file.ok()).toBeTruthy();
        expect(await file.text()).toBe('Persisted despite lost acknowledgement');
        expect(JSON.stringify(await (await conversation.customer.get(conversation.path)).json())).not.toContain(attempt);
      }
    } finally { await conversation.customer.dispose(); }
  });
}

test('stores and retrieves complete 12 MiB and 20 MiB attachments through the app proxy', async ({ playwright }) => {
  const conversation = await localConversation(playwright, 'Large attachment customer');
  try {
    for (const size of [12, 20]) {
      const bytes = Buffer.alloc(size * 1024 * 1024, 'x');
      const response = await apiA.post(`/api/workspace/conversations/${conversation.id}/messages`, { multipart: {
        content: `${size} MiB attachment`, message_type: 'outgoing', private: 'false',
        'attachments[]': { name: `complete-${size}.txt`, mimeType: 'text/plain', buffer: bytes }
      } });
      expect(response.ok()).toBeTruthy();
      const message = await response.json();
      expect(message.attachments[0].file_size).toBe(bytes.length);
      const file = await conversation.customer.get(message.attachments[0].data_url);
      expect(file.ok()).toBeTruthy();
      expect((await file.body()).equals(bytes)).toBeTruthy();
    }
  } finally { await conversation.customer.dispose(); }
});

test('closes real event streams on account switch and membership revocation', async ({ page, playwright }) => {
  test.setTimeout(90000);
  const original = await openRealtime(apiA);
  expect((await apiA.post('/api/auth/account', { data: { accountId: fixture.switch_account_id } })).ok()).toBeTruthy();
  await expect.poll(() => original.closed).toBeTruthy();
  expect(original.frames.some(frame => frame.event === 'session-ended' && frame.data.reason === 'account-switch')).toBeTruthy();
  const switched = await openRealtime(apiA);
  expect((await apiA.post('/api/auth/account', { data: { accountId: fixture.accounts[0].id } })).ok()).toBeTruthy();
  await expect.poll(() => switched.closed).toBeTruthy();
  expect((await apiA.post('/api/workspace/inbox_members', { data: { inbox_id: fixture.accounts[0].api_inbox_id, user_ids: [fixture.users[0].id, fixture.agent.id] } })).ok()).toBeTruthy();
  const draftConversation = await localConversation(playwright, 'Revocation draft customer');
  await draftConversation.customer.dispose();
  await page.context().addCookies((await apiAgent.storageState()).cookies);
  await page.goto('/inbox');
  await page.locator('.conversation-item').filter({ hasText: 'Revocation draft customer' }).click();
  await page.getByLabel('Reply to customer').fill('Sensitive revoked-session draft');
  const restricted = await openRealtime(apiAgent);
  await new Promise<void>((resolve, reject) => {
    const child = spawn('docker', ['compose', 'exec', '-T', 'rails', 'bundle', 'exec', 'rails', 'runner', '/app/omnigrow-test-fixture.rb'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', chunk => { out += chunk; }); child.stderr.resume();
    child.stdin.end(JSON.stringify({ action: 'revoke_membership', account_id: fixture.accounts[0].id, user_id: fixture.agent.id }));
    child.on('error', reject); child.on('exit', code => code === 0 && out.includes('OG_MEMBERSHIP_REVOKED') ? resolve() : reject(new Error('Fixture membership revocation failed.')));
  });
  await expect.poll(() => restricted.closed, { timeout: 45000 }).toBeTruthy();
  expect(restricted.frames.some(frame => frame.event === 'session-ended' && frame.data.reason === 'revoked')).toBeTruthy();
  expect((await apiAgent.get('/api/realtime')).status()).toBe(403);
  await expect(page).toHaveURL(/\/login$/, { timeout: 45000 });
  expect(await page.evaluate(() => Object.values(sessionStorage).some(value => value.includes('Sensitive revoked-session draft')))).toBe(false);
});

test('hardening: request ids, security policy, health probe, session limits, and engine webhook authenticity', async ({ page, request }) => {
  const login = await request.get('/login');
  expect(login.headers()['x-request-id']).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
  const policy = login.headers()['content-security-policy-report-only'];
  const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(policy)?.[1];
  expect(nonce).toBeTruthy();
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).toContain('report-uri /api/csp-report');
  // Dynamic rendering lets Next.js tag its own scripts with the per-request nonce.
  expect(await login.text()).toContain(`nonce="${nonce}"`);
  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: 'ok', messaging: 'reachable' });
  expect((await request.post('/api/csp-report', { headers: { 'Content-Type': 'application/csp-report' }, data: JSON.stringify({ 'csp-report': { 'document-uri': `${base}/inbox`, 'violated-directive': 'script-src', 'blocked-uri': 'https://evil.example/x.js' } }) })).status()).toBe(204);
  // Provider callbacks the engine cannot authenticate are rejected before any message is created.
  const twilio = { AccountSid: 'AC00000000000000000000000000000000', From: '+15550000001', To: '+15550000000', Body: 'spoofed inbound SMS', SmsSid: 'SM00000000000000000000000000000000' };
  expect((await request.post(`${engine}/twilio/callback`, { form: twilio })).status()).toBe(403);
  expect((await request.post(`${engine}/twilio/delivery_status`, { form: { AccountSid: twilio.AccountSid, From: twilio.To, MessageSid: twilio.SmsSid, MessageStatus: 'delivered' } })).status()).toBe(403);
  expect((await request.post(`${engine}/webhooks/whatsapp/+15550000000`, { data: { object: 'whatsapp_business_account', entry: [] } })).status()).toBe(401);
  // Endpoints the engine calls back must be HTTPS, whatever the browser form says.
  expect((await apiA.post('/api/workspace/webhooks', { data: { webhook: { url: 'http://insecure.omnigrow.invalid/events', subscriptions: ['message_created'] } } })).status()).toBe(400);
  // Live connections are capped per sign-in.
  for (let index = 0; index < 6; index++) await openRealtime(apiA);
  const { cookies } = await apiA.storageState();
  const seventh = await fetch(`${base}/api/realtime`, { headers: { Cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ') } });
  expect(seventh.status).toBe(429);
  await seventh.body?.cancel();
  closeRealtimeStreams();
  // A validly sealed session older than the absolute limit is rejected.
  loadEnvConfig(process.cwd());
  const { sealData } = await import('iron-session');
  const stale = await sealData({
    auth: { 'access-token': 'expired', client: 'expired', uid: 'expired@og-tests.local' },
    profile: { id: 1, name: 'Expired', email: 'expired@og-tests.local', accounts: [{ id: 1, name: 'Expired', role: 'agent' }], account_id: 1 },
    accountId: 1, createdAt: Date.now() - 25 * 60 * 60 * 1000, lastSeenAt: Date.now()
  }, { password: process.env.SESSION_SECRET!, ttl: 48 * 60 * 60 });
  expect((await request.get('/api/auth/me', { headers: { Cookie: `og_session=${stale}` } })).status()).toBe(401);
  // Agents are told that account reports are administrator-only instead of seeing an error.
  await page.context().addCookies((await apiAgent.storageState()).cookies);
  await page.goto('/reports');
  await expect(page.getByText('Reports are available to workspace administrators')).toBeVisible();
});

test('verifies MFA in the branded login without exposing its challenge token', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(fixture.mfa.email);
  await page.getByLabel('Password', { exact: true }).fill(fixture.mfa.password);
  const challenge = page.waitForResponse(response => response.url().endsWith('/api/auth/login'));
  await page.getByRole('button', { name: 'Sign in to your workspace' }).click();
  expect(await (await challenge).json()).toEqual({ mfaRequired: true });
  expect((await page.request.get('/api/workspace/inboxes')).status()).toBe(401);
  await page.getByRole('button', { name: 'Use a recovery code' }).click();
  await page.getByLabel('Recovery code', { exact: true }).fill(fixture.mfa.backup_code);
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(/\/inbox$/);
  expect((await page.request.get('/api/workspace/inboxes')).ok()).toBeTruthy();
});

test('revokes the authenticated session and closes event streams on logout', async ({ page }) => {
  const oldStream = await openRealtime(apiA);
  await useExistingSession(page);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get('/api/workspace/conversations')).status()).toBe(401);
  await expect.poll(() => oldStream.closed).toBeTruthy();
  expect(oldStream.frames.some(frame => frame.event === 'session-ended' && frame.data.reason === 'logout')).toBeTruthy();
  expect((await apiA.get('/api/realtime')).status()).toBe(401);
});
