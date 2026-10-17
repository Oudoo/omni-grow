import 'server-only';
import { ApiError, engineFetch, loadProfile, log, type SessionData } from './server';

export type EndReason = 'logout' | 'account-switch' | 'revoked';
type Auth = NonNullable<SessionData['auth']>;
export interface StreamHandle {
  accountId: number;
  // Absolute session deadline captured when the stream opened. Idle expiry is enforced by the
  // cookie on ordinary requests, not here: an open tab keeps the session alive by design.
  expiresAt: number;
  revoke: (reason: EndReason) => void; // Tells the browser the session ended, then closes.
  stop: () => void;                     // Closes silently; the browser reconnects.
}
interface Group { auth: Auth; handles: Set<StreamHandle>; timer?: ReturnType<typeof setInterval>; checking: boolean }

// Streams are grouped per sign-in (uid + device token). One authorization check per group every
// 20 seconds covers every tab of that sign-in and bounds revocation on other app instances. The
// registry lives on globalThis so it survives development hot reload.
const AUTHORIZATION_INTERVAL_MS = 20_000;
export const MAX_STREAMS_PER_SESSION = Math.min(50, Math.max(1, Number(process.env.REALTIME_MAX_STREAMS) || 6));
const scope = globalThis as typeof globalThis & { omniGrowStreamGroups?: Map<string, Group> };
const groups = scope.omniGrowStreamGroups ||= new Map();
const key = (auth: Auth) => `${auth.uid}\u0000${auth.client}`;

export function streamCount(auth: Auth) {
  return groups.get(key(auth))?.handles.size ?? 0;
}

export function assertStreamCapacity(auth: Auth) {
  if (streamCount(auth) >= MAX_STREAMS_PER_SESSION) throw new ApiError(429, 'Too many live connections for this sign-in. Close other OmniGrow tabs and retry.');
}

export function registerStream(auth: Auth, handle: StreamHandle) {
  // Recheck synchronously with insertion: several requests can pass the early check before
  // their asynchronous profile lookups complete.
  assertStreamCapacity(auth);
  const id = key(auth);
  let group = groups.get(id);
  if (!group) {
    const created: Group = { auth, handles: new Set(), checking: false };
    created.timer = setInterval(() => { void authorize(created, id); }, AUTHORIZATION_INTERVAL_MS);
    groups.set(id, created);
    group = created;
  }
  group.handles.add(handle);
  return () => {
    group.handles.delete(handle);
    if (!group.handles.size && groups.get(id) === group) { clearInterval(group.timer); groups.delete(id); }
  };
}

async function authorize(group: Group, id: string) {
  if (group.checking || !group.handles.size || groups.get(id) !== group) return;
  group.checking = true;
  try {
    const now = Date.now();
    for (const handle of [...group.handles]) if (now > handle.expiresAt) handle.revoke('revoked');
    if (!group.handles.size) return;
    const profile = await loadProfile(group.auth);
    const active = new Set<number>();
    for (const accountId of new Set([...group.handles].map(handle => handle.accountId))) {
      if (!profile.accounts.some(account => account.id === accountId)) continue;
      const response = await engineFetch(`/api/v1/accounts/${accountId}/business/context`, group.auth);
      if (response.ok) active.add(accountId);
      else if (![401, 403, 404].includes(response.status)) throw new ApiError(503, 'Workspace access could not be checked.');
    }
    for (const handle of [...group.handles]) {
      if (!active.has(handle.accountId)) handle.revoke('revoked');
    }
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      for (const handle of [...group.handles]) handle.revoke('revoked');
    } else {
      // Transport outage: end the streams so browsers reconnect and keep their drafts.
      log('warn', 'realtime authorization check failed; closing streams for reconnect', { name: error instanceof Error ? error.name : 'UnknownError' });
      for (const handle of [...group.handles]) handle.stop();
    }
  } finally {
    group.checking = false;
  }
}

export function endSessionStreams(auth: Auth, reason: EndReason) {
  for (const handle of [...(groups.get(key(auth))?.handles || [])]) handle.revoke(reason);
}

export function closeAllStreams() {
  for (const group of [...groups.values()]) for (const handle of [...group.handles]) handle.stop();
}

// Next.js waits for in-flight requests before exiting on SIGTERM. Live event streams never finish
// on their own, so close them first; browsers reconnect to the replacement instance and keep drafts.
export function installShutdownHandlers() {
  const proc = globalThis.process as (NodeJS.Process & { omniGrowShutdownInstalled?: boolean }) | undefined;
  if (!proc?.once || proc.omniGrowShutdownInstalled) return;
  proc.omniGrowShutdownInstalled = true;
  const shutdown = () => { closeAllStreams(); };
  proc.once('SIGTERM', shutdown);
  proc.once('SIGINT', shutdown);
}
