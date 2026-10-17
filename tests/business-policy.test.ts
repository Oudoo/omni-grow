import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedBusinessRequest, allowedOperatorRequest } from '../src/lib/business-policy';

test('business proxy accepts only its fixed account-relative API surface', () => {
  for (const [path, method] of [['rooms', 'GET'], ['rooms/4/messages', 'POST'], ['rooms/4/meetings/9/join', 'POST'], ['documents/3/content', 'GET'], ['branding', 'PATCH']]) assert.equal(allowedBusinessRequest(path, method), true);
  for (const path of ['../accounts/2/business/rooms', 'rooms/0/messages', 'rooms/1/messages/../../documents/4/content', 'http://remote/rooms', 'accounts/2/rooms', 'documents/3/blob', 'rooms/1/members/2']) assert.equal(allowedBusinessRequest(path, 'GET'), false);
  assert.equal(allowedBusinessRequest('documents/3/content', 'POST'), false);
  assert.equal(allowedBusinessRequest('rooms/3/meetings/9/join', 'GET'), false);
  assert.equal(allowedBusinessRequest('context', 'PATCH'), false);
  assert.equal(allowedBusinessRequest('subscription', 'GET'), true);
  assert.equal(allowedBusinessRequest('subscription', 'POST'), false);
});
test('operator proxy exposes provisioning and packages without a tenant data proxy', () => {
  assert.equal(allowedOperatorRequest('businesses', 'POST'), true);
  assert.equal(allowedOperatorRequest('businesses/2/invitations', 'POST'), true);
  assert.equal(allowedOperatorRequest('businesses/2/subscription', 'POST'), true);
  assert.equal(allowedOperatorRequest('businesses/2/subscription', 'GET'), true);
  assert.equal(allowedOperatorRequest('businesses/2/subscription', 'DELETE'), false);
  for (const path of ['businesses/2/documents', 'accounts/2/conversations', 'businesses/2/users/1/password', 'businesses/2/../1']) assert.equal(allowedOperatorRequest(path, 'GET'), false);
  assert.equal(allowedOperatorRequest('businesses/2', 'DELETE'), false);
});
