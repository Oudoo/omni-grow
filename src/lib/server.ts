import 'server-only';
import { cookies } from 'next/headers';
import { getIronSession, type IronSession } from 'iron-session';
import { NextRequest, NextResponse } from 'next/server';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { sameOrigin } from './policy';
import { SESSION_ABSOLUTE_MS, sessionExpired, sessionNeedsRenewal } from './session-policy';
import type { Profile } from './types';

export { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from './session-policy';

export interface SessionData {
  pendingMfa?: { token: string; expiresAt: number };
  auth?: { 'access-token': string; client: string; uid: string };
  profile?: Profile;
  accountId?: number;
  createdAt?: number;   // Sign-in time: absolute 24-hour lifetime.
  lastSeenAt?: number;  // Last request: 8-hour idle lifetime, renewed by route handlers.
}
export type ActiveSession = IronSession<SessionData> & Required<Pick<SessionData, 'auth' | 'profile' | 'accountId' | 'createdAt' | 'lastSeenAt'>>;

export function appUrl() { return process.env.APP_URL || 'http://localhost:3000'; }
export function engineUrl() { return (process.env.ENGINE_URL || 'http://127.0.0.1:3001').replace(/\/$/, ''); }
export function publicEngineUrl() { return (process.env.NEXT_PUBLIC_ENGINE_URL || 'http://localhost:3001').replace(/\/$/, ''); }

// Structured, single-line logs without request bodies, credentials or customer content.
export function log(level: 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, at: new Date().toISOString(), service: 'omnigrow-app', msg, ...fields });
  if (level === 'error') console.error(line); else if (level === 'warn') console.warn(line); else console.log(line);
}

const requestIdPattern = /^[A-Za-z0-9._-]{1,128}$/;
// Set by Caddy (X-Request-ID) in production and by src/proxy.ts otherwise.
export function requestReference(request?: NextRequest) {
  const id = request?.headers.get('x-request-id');
  return id && requestIdPattern.test(id) ? id : undefined;
}

interface SessionActivity { signIn?: string; lastSeenAt?: number }

async function sessionCookie<T extends object>(cookieName: string) {
  const cookieStore = await cookies();
  const password = process.env.SESSION_SECRET;
  if (!password || password.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters. Run npm run setup.');
  return getIronSession<T>(cookieStore, {
    password,
    cookieName,
    ttl: SESSION_ABSOLUTE_MS / 1000,
    cookieOptions: { httpOnly: true, secure: new URL(appUrl()).protocol === 'https:', sameSite: 'lax', path: '/' },
    onUnsealError: reason => { if (reason !== 'expired') log('warn', 'session cookie rejected', { reason }); }
  });
}

// Activity may be renewed by an older in-flight request. Keep it separate from authentication
// and workspace selection so its Set-Cookie cannot undo a switch or recreate a logged-out session.
function signInKey(state: SessionData) {
  return createHash('sha256').update(JSON.stringify([state.auth?.uid, state.auth?.client, state.auth?.['access-token'], state.createdAt])).digest('hex');
}

export async function session() {
  const state = await sessionCookie<SessionData>('og_session');
  if (state.auth && state.createdAt) {
    const activity = await sessionCookie<SessionActivity>('og_activity');
    if (activity.signIn === signInKey(state) && Number.isFinite(activity.lastSeenAt)) {
      state.lastSeenAt = Math.max(state.lastSeenAt || 0, activity.lastSeenAt!);
    }
  }
  return state;
}

export async function clearSessionActivity() {
  (await sessionCookie<SessionActivity>('og_activity')).destroy();
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'ApiError'; }
}

export function checkOrigin(request: NextRequest) {
  if (!sameOrigin(request.headers.get('origin'), appUrl())) throw new ApiError(403, 'This action must come from your OmniGrow workspace.');
}

export function sessionIsActive(state: SessionData): state is SessionData & Required<Pick<SessionData, 'auth' | 'profile' | 'accountId' | 'createdAt' | 'lastSeenAt'>> {
  return !!(state.auth && state.profile && state.accountId) && !sessionExpired(state);
}

// Route handlers only: renewing writes the cookie, which Server Components cannot do.
export async function requireSession(): Promise<ActiveSession> {
  const state = await session();
  if (!sessionIsActive(state)) throw new ApiError(401, 'Please sign in to OmniGrow.');
  if (sessionNeedsRenewal(state)) {
    const activity = await sessionCookie<SessionActivity>('og_activity');
    activity.signIn = signInKey(state);
    activity.lastSeenAt = state.lastSeenAt = Date.now();
    await activity.save();
  }
  return state as ActiveSession;
}

// Browsers refuse cookies over 4 KB. A user who belongs to many workspaces keeps ids and roles in
// the session; names are fetched from /api/auth/me instead.
export async function saveSession(state: IronSession<SessionData>) {
  try {
    await state.save();
  } catch (error) {
    if (!(error instanceof Error) || !/too big/i.test(error.message) || !state.profile) throw error;
    state.profile = { ...state.profile, accounts: state.profile.accounts.map(({ id, role }) => ({ id, name: '', role })) };
    await state.save();
  }
}

// Only behind a trusted proxy that overwrites X-Real-IP (Caddy in compose.production.yaml).
export function clientIp(request?: NextRequest) {
  const ip = request?.headers.get('x-real-ip');
  return process.env.TRUST_PROXY === 'true' && ip && isIP(ip) ? ip : undefined;
}

export async function engineFetch(path: string, auth?: SessionData['auth'], init: RequestInit = {}, request?: NextRequest) {
  const headers = new Headers(init.headers);
  if (auth) { for (const [key, value] of Object.entries(auth)) headers.set(key, value); }
  headers.set('Accept', 'application/json');
  // The engine rate limits and logs by client address; without this every agent looks like the app container.
  const ip = clientIp(request);
  if (ip) headers.set('X-Forwarded-For', ip);
  const reference = requestReference(request);
  if (reference) headers.set('X-Request-Id', reference);
  return fetch(`${engineUrl()}${path}`, { ...init, headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000) });
}

// Reads a request body while counting bytes, so a chunked upload cannot bypass the size limit.
export async function readLimitedBytes(request: NextRequest, maxBytes: number, message = 'This request is too large.') {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new ApiError(413, message);
  if (!request.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel().catch(() => {}); throw new ApiError(413, message); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function readJsonBody(request: NextRequest, maxBytes = 100_000): Promise<Record<string, unknown>> {
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw new ApiError(415, 'Send this action as JSON.');
  const text = new TextDecoder().decode(await readLimitedBytes(request, maxBytes));
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ApiError(400, 'Invalid JSON.'); }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') throw new ApiError(400, 'Expected an object.');
  return parsed as Record<string, unknown>;
}

export async function jsonBody(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new ApiError(502, 'The messaging service returned an unexpected response.'); }
}

export async function loadProfile(auth: SessionData['auth'], request?: NextRequest): Promise<Profile> {
  const response = await engineFetch('/api/v1/profile', auth, {}, request);
  if (response.status === 401 || response.status === 403) throw new ApiError(response.status, 'Your messaging session is no longer authorized. Please sign in again.');
  if (!response.ok) throw new ApiError(response.status >= 500 ? 503 : response.status, 'The messaging service is temporarily unavailable. Please retry.');
  const data = await jsonBody(response);
  return data.data || data;
}

export function fail(error: unknown, request?: NextRequest) {
  const reference = requestReference(request);
  const route = request?.nextUrl.pathname;
  if (error instanceof ApiError) {
    if (error.status >= 500) log('warn', 'engine unavailable', { reference, route, method: request?.method, status: error.status });
    return NextResponse.json({ error: error.message, ...(reference ? { reference } : {}) }, { status: error.status });
  }
  const err = error instanceof Error ? error : new Error(String(error));
  const cause = (err as { cause?: { code?: string; name?: string } }).cause;
  // Bodies and upstream responses are never part of these errors; messages and stacks are safe to log.
  log('error', 'request failed', {
    reference, route, method: request?.method, name: err.name, message: err.message, cause: cause?.code || cause?.name,
    stack: err.stack?.split('\n').slice(1, 6).map(line => line.trim())
  });
  return NextResponse.json({ error: 'The messaging service is unavailable. Please retry; your draft is preserved.', ...(reference ? { reference } : {}) }, { status: 503 });
}

export function publicProfile(profile: Profile, accountId: number) {
  return {
    id: profile.id, name: profile.name, email: profile.email,
    accounts: profile.accounts.map(({ id, name, role }) => ({ id, name: String(name ?? '').slice(0, 60), role })),
    account_id: accountId
  };
}
