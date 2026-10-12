import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS, SESSION_RENEW_MS, sessionAbsoluteDeadline, sessionExpired, sessionNeedsRenewal } from '../src/lib/session-policy';

const now = 1_800_000_000_000;
test('sessions end after eight idle hours or twenty-four hours in total', () => {
  assert.equal(sessionExpired({ createdAt: now - 60_000, lastSeenAt: now - 60_000 }, now), false);
  assert.equal(sessionExpired({ createdAt: now - SESSION_ABSOLUTE_MS + 60_000, lastSeenAt: now }, now), false, 'active just inside the absolute limit');
  assert.equal(sessionExpired({ createdAt: now - SESSION_ABSOLUTE_MS - 1, lastSeenAt: now }, now), true, 'absolute limit applies even when active');
  assert.equal(sessionExpired({ createdAt: now - 60_000, lastSeenAt: now - SESSION_IDLE_MS - 1 }, now), true, 'idle limit');
  assert.equal(sessionExpired({ createdAt: now + 120_000, lastSeenAt: now }, now), true, 'timestamps from the future are rejected');
  assert.equal(sessionExpired({}, now), true, 'cookies written by the previous release carry no anchors and must sign in again');
  assert.equal(sessionExpired({ createdAt: Number.NaN, lastSeenAt: now }, now), true);
});
test('renewal happens at most every fifteen minutes and never for an expired session', () => {
  assert.equal(sessionNeedsRenewal({ createdAt: now - 60_000, lastSeenAt: now - 60_000 }, now), false);
  assert.equal(sessionNeedsRenewal({ createdAt: now - 60_000, lastSeenAt: now - SESSION_RENEW_MS - 1 }, now), true);
  assert.equal(sessionNeedsRenewal({ createdAt: now - SESSION_ABSOLUTE_MS - 1, lastSeenAt: now - SESSION_RENEW_MS - 1 }, now), false);
});
test('the realtime relay uses the absolute deadline', () => {
  assert.equal(sessionAbsoluteDeadline({ createdAt: now }), now + SESSION_ABSOLUTE_MS);
});
