import 'server-only';
import type { SessionData } from './server';

type EndReason = 'logout' | 'account-switch' | 'revoked';
type EndStream = (reason: EndReason) => void;
// A shared registry also survives development hot reload. Each instance checks
// engine authorization every 20 seconds to cover revocation on other instances.
const scope = globalThis as typeof globalThis & { omniGrowStreams?: Map<string, Set<EndStream>> };
const streams = scope.omniGrowStreams ||= new Map();
const key = (auth: NonNullable<SessionData['auth']>) => `${auth.uid}\u0000${auth.client}`;
export function registerStream(auth: NonNullable<SessionData['auth']>, end: EndStream) {
  const id = key(auth), group = streams.get(id) || new Set<EndStream>();
  group.add(end); streams.set(id, group);
  return () => { group.delete(end); if (!group.size) streams.delete(id); };
}
export function endSessionStreams(auth: NonNullable<SessionData['auth']>, reason: EndReason) {
  for (const end of [...(streams.get(key(auth)) || [])]) end(reason);
}
