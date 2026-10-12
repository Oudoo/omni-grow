import 'server-only';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { NextRequest, NextResponse } from 'next/server';
import { sameOrigin } from './policy';
import type { Profile } from './types';

export interface SessionData { pendingMfa?: { token: string; expiresAt: number }; auth?: { 'access-token': string; client: string; uid: string }; profile?: Profile; accountId?: number; issuedAt?: number }
export function appUrl() { return process.env.APP_URL || 'http://localhost:3000'; }
export function engineUrl() { return (process.env.ENGINE_URL || 'http://127.0.0.1:3001').replace(/\/$/, ''); }
export function publicEngineUrl() { return (process.env.NEXT_PUBLIC_ENGINE_URL || 'http://localhost:3001').replace(/\/$/, ''); }
export async function session() {
  const cookieStore = await cookies();
  const password = process.env.SESSION_SECRET;
  if (!password || password.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters. Run npm run setup.');
  return getIronSession<SessionData>(cookieStore, { password, cookieName: 'og_session', ttl: 8 * 60 * 60,
    cookieOptions: { httpOnly: true, secure: new URL(appUrl()).protocol === 'https:', sameSite: 'lax', path: '/' } });
}
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export function checkOrigin(request: NextRequest) {
  if (!sameOrigin(request.headers.get('origin'), appUrl())) throw new ApiError(403, 'This action must come from your OmniGrow workspace.');
}
export async function requireSession() {
  const state = await session();
  if (!state.auth || !state.profile || !state.accountId || !state.issuedAt || Date.now() - state.issuedAt > 8 * 60 * 60 * 1000) throw new ApiError(401, 'Please sign in to OmniGrow.');
  return state as typeof state & Required<SessionData>;
}
export async function engineFetch(path: string, auth?: SessionData['auth'], init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (auth) { for (const [key, value] of Object.entries(auth)) headers.set(key, value); }
  headers.set('Accept', 'application/json');
  const response = await fetch(`${engineUrl()}${path}`, { ...init, headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000) });
  return response;
}
export async function jsonBody(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new ApiError(502, 'The messaging service returned an unexpected response.'); }
}
export async function loadProfile(auth: SessionData['auth']): Promise<Profile> {
  const response = await engineFetch('/api/v1/profile', auth);
  if (response.status === 401 || response.status === 403) throw new ApiError(response.status, 'Your messaging session is no longer authorized. Please sign in again.');
  if (!response.ok) throw new ApiError(response.status >= 500 ? 503 : response.status, 'The messaging service is temporarily unavailable. Please retry.');
  const data = await jsonBody(response);
  return data.data || data;
}
export function fail(error: unknown) {
  if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status });
  // Do not log upstream response bodies or URLs containing channel credentials.
  console.error('OmniGrow request failed:', error instanceof Error ? error.name : 'UnknownError');
  return NextResponse.json({ error: 'The messaging service is unavailable. Please retry; your draft is preserved.' }, { status: 503 });
}
export function publicProfile(profile: Profile, accountId: number) {
  return { id: profile.id, name: profile.name, email: profile.email,
    accounts: profile.accounts.map(({ id, name, role }) => ({ id, name, role })), account_id: accountId };
}
