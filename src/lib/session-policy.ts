// Pure session lifetime rules. Shared by the server helpers, the realtime relay and unit tests.
// A session ends 8 hours after the last request that carried it (idle), and 24 hours after sign-in
// no matter what (absolute). Route handlers renew the idle anchor at most every 15 minutes.
export const SESSION_ABSOLUTE_MS = 24 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000;
export const SESSION_RENEW_MS = 15 * 60 * 1000;

export interface SessionLifetime { createdAt?: number; lastSeenAt?: number }

export function sessionExpired(state: SessionLifetime, now = Date.now()) {
  const { createdAt, lastSeenAt } = state;
  if (typeof createdAt !== 'number' || typeof lastSeenAt !== 'number' || !Number.isFinite(createdAt) || !Number.isFinite(lastSeenAt)) return true;
  if (createdAt > now + 60_000 || lastSeenAt > now + 60_000) return true; // Clock skew or a tampered seal.
  return now - createdAt > SESSION_ABSOLUTE_MS || now - lastSeenAt > SESSION_IDLE_MS;
}

export function sessionNeedsRenewal(state: SessionLifetime, now = Date.now()) {
  return !sessionExpired(state, now) && now - (state.lastSeenAt as number) > SESSION_RENEW_MS;
}

export function sessionAbsoluteDeadline(state: SessionLifetime) {
  return (state.createdAt ?? 0) + SESSION_ABSOLUTE_MS;
}
