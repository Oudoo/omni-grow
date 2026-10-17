import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedWorkspaceRequest, insecureOutboundUrl, redactSecrets, safeExternalUrl, sameOrigin } from '../src/lib/policy';

test('allows supported conversation operations and denies cross-account or arbitrary proxy paths', () => {
  assert.equal(allowedWorkspaceRequest('conversations/12/messages', 'POST'), true);
  assert.equal(allowedWorkspaceRequest('conversations/12/toggle_status', 'POST'), true);
  for (const path of ['accounts/2/conversations', '../accounts/2/conversations', 'conversations/0/messages', 'conversations/-1/messages', 'conversations/1/messages/../2', 'auth/sign_in', 'super_admin', 'inboxes/1/reset_secret', 'conversations/1%2fmessages']) assert.equal(allowedWorkspaceRequest(path, 'GET'), false, path);
  assert.equal(allowedWorkspaceRequest('channels/twilio_channel', 'POST'), true);
  assert.equal(allowedWorkspaceRequest('channels/twilio_channel', 'GET'), false);
  assert.equal(allowedWorkspaceRequest('inboxes/1', 'DELETE'), false);
  assert.equal(allowedWorkspaceRequest('agents', 'PUT'), false);
});
test('requires an exact origin for cookie-authenticated writes', () => {
  assert.equal(sameOrigin('https://og.example.com', 'https://og.example.com/'), true);
  for (const origin of [null, 'null', 'https://og.example.com.evil.test', 'http://og.example.com', 'https://evil.test', 'not-a-url']) assert.equal(sameOrigin(origin, 'https://og.example.com'), false);
});
test('redacts secrets recursively without removing the public widget token', () => {
  const response = { payload: [{ website_token: 'public-widget-id', bot_token: 'secret', provider_config: { api_key: 'secret', app_secret: 'secret' }, imap_password: 'secret', channel: { access_token: 'secret', hmac_token: 'secret', name: 'support' } }], access_token: 'secret', pubsub_token: 'secret', line_channel_token: 'secret', line_channel_secret: 'secret', omniauth_token: 'secret', user_access_token: 'secret', page_access_token: 'secret' };
  assert.deepEqual(redactSecrets(response), { payload: [{ website_token: 'public-widget-id', channel: { name: 'support' } }] });
  assert.equal(JSON.stringify(redactSecrets(response)).includes('secret'), false);
});
test('attachment links accept only HTTP and HTTPS URLs', () => {
  assert.equal(safeExternalUrl('https://files.example.com/image.png'), 'https://files.example.com/image.png');
  for (const value of ['javascript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', '//evil.test', 'not-a-url', undefined]) assert.equal(safeExternalUrl(value), undefined);
});
test('endpoints the engine calls back must use HTTPS', () => {
  assert.equal(insecureOutboundUrl('webhooks', 'POST', { webhook: { url: 'https://crm.example.com/events' } }), undefined);
  assert.match(insecureOutboundUrl('webhooks', 'POST', { webhook: { url: 'http://crm.example.com/events' } }) || '', /https/);
  assert.match(insecureOutboundUrl('webhooks/3', 'PATCH', { url: 'ftp://crm.example.com' }) || '', /https/);
  assert.match(insecureOutboundUrl('agent_bots', 'POST', { outgoing_url: 'http://bot.example.com' }) || '', /https/);
  assert.equal(insecureOutboundUrl('agent_bots', 'POST', { outgoing_url: 'https://bot.example.com' }), undefined);
  assert.match(insecureOutboundUrl('inboxes', 'POST', { channel: { type: 'api', webhook_url: 'http://reply.example.com' } }) || '', /https/);
  assert.equal(insecureOutboundUrl('inboxes', 'POST', { channel: { type: 'web_widget', website_url: 'http://localhost:3000' } }), undefined, 'website_url is a display attribute, not a callback');
  assert.equal(insecureOutboundUrl('inboxes/5', 'PATCH', { name: 'renamed' }), undefined);
  assert.equal(insecureOutboundUrl('webhooks', 'GET', {}), undefined);
  assert.equal(insecureOutboundUrl('contacts', 'POST', { url: 'http://example.com' }), undefined, 'only callback endpoints are checked');
});
