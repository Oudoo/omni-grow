import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as crypto from 'node:crypto';
import * as net from 'node:net';
import * as iron from 'iron-session';
import { deferred, loadModule } from './support/load-module';

const password = 'synthetic-test-password-at-least-thirty-two-characters';
const profile = { id: 1, name: 'Test agent', email: 'agent@example.invalid', accounts: [{ id: 1, name: 'First', role: 'administrator' }, { id: 2, name: 'Second', role: 'administrator' }], account_id: 1 };
type CookieChange = { name: string; value: string; options?: { maxAge?: number } };
class CookieStore {
  outgoing: CookieChange[] = [];
  constructor(public values: Map<string, string>) {}
  get(name: string) { const value = this.values.get(name); return value === undefined ? undefined : { value }; }
  set(name: string, value: string, options?: CookieChange['options']) {
    this.outgoing.push({ name, value, options });
    if (options?.maxAge === 0) this.values.delete(name); else this.values.set(name, value);
  }
}
const apply = (jar: Map<string, string>, store: CookieStore) => {
  for (const { name, value, options } of store.outgoing) {
    if (options?.maxAge === 0) jar.delete(name); else jar.set(name, value);
  }
};
const request = (path: string, method = 'GET', body?: unknown) => Object.assign(new Request(`http://localhost:3000${path}`, {
  method, headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) })
}), { nextUrl: new URL(`http://localhost:3000${path}`) });

async function fixture() {
  let now = Date.now();
  class Clock extends Date { static now() { return now; } }
  const context = new AsyncLocalStorage<CookieStore>();
  const started = deferred(), release = deferred();
  const globals = {
    Date: Clock,
    process: { env: { SESSION_SECRET: password, APP_URL: 'http://localhost:3000' } },
    fetch: async (url: string) => {
      if (url.endsWith('/contacts')) { started.resolve(); await release.promise; return Response.json({ payload: [] }); }
      if (url.endsWith('/api/v1/profile')) return Response.json(profile);
      if (url.endsWith('/auth/sign_out')) return Response.json({ error: 'Synthetic outage' }, { status: 503 });
      throw new Error(`Unexpected fixture request: ${url}`);
    }
  };
  const policy = loadModule('src/lib/policy.ts', {});
  const sessionPolicy = loadModule('src/lib/session-policy.ts', {}, { Date: Clock });
  const server = loadModule('src/lib/server.ts', {
    'server-only': {}, 'next/headers': { cookies: async () => context.getStore() }, 'iron-session': iron,
    'next/server': { NextResponse: Response }, 'node:net': net, 'node:crypto': crypto, './policy': policy, './session-policy': sessionPolicy
  }, globals);
  const imports = { 'next/server': { NextResponse: Response }, '@/lib/server': server, '@/lib/policy': policy, '@/lib/realtime-server': { endSessionStreams: () => {} } };
  const workspace = loadModule('src/app/api/workspace/[...path]/route.ts', imports);
  const account = loadModule('src/app/api/auth/account/route.ts', imports);
  const logout = loadModule('src/app/api/auth/logout/route.ts', imports);
  const state = { auth: { 'access-token': 'synthetic', uid: profile.email, client: 'synthetic-device' }, profile, accountId: 1, createdAt: Date.now() - 20 * 60_000, lastSeenAt: Date.now() - 20 * 60_000 };
  const jar = new Map([['og_session', await iron.sealData(state, { password, ttl: 86400 })]]);
  const cookies = () => new CookieStore(new Map(jar));
  return { context, started, release, server, workspace, account, logout, jar, cookies, advance: (ms: number) => { now += ms; } };
}

test('late activity renewal cannot overwrite a successful workspace switch', async () => {
  const f = await fixture();
  const slowCookies = f.cookies();
  const slow = f.context.run(slowCookies, () => f.workspace.GET(request('/api/workspace/contacts'), { params: Promise.resolve({ path: ['contacts'] }) }));
  await f.started.promise;
  const switchCookies = f.cookies();
  const response = await f.context.run(switchCookies, () => f.account.POST(request('/api/auth/account', 'POST', { accountId: 2 })));
  assert.equal(response.status, 200);
  apply(f.jar, switchCookies);
  f.release.resolve(); await slow;
  apply(f.jar, slowCookies);
  const selected = await iron.unsealData<{ accountId: number }>(f.jar.get('og_session')!, { password });
  assert.equal(selected.accountId, 2, 'An older response must not restore workspace 1');
});

test('activity extends idle time without rewriting authentication, but cannot extend the absolute deadline', async () => {
  const f = await fixture();
  const original = f.jar.get('og_session');
  for (let i = 0; i < 3; i++) {
    const current = f.cookies();
    await f.context.run(current, () => f.server.requireSession());
    assert.deepEqual(current.outgoing.map(cookie => cookie.name), ['og_activity']);
    apply(f.jar, current);
    assert.equal(f.jar.get('og_session'), original);
    f.advance(7 * 60 * 60_000);
  }
  const finalRenewal = f.cookies();
  await f.context.run(finalRenewal, () => f.server.requireSession());
  apply(f.jar, finalRenewal);
  f.advance(3 * 60 * 60_000);
  await assert.rejects(f.context.run(f.cookies(), () => f.server.requireSession()), { status: 401 });
});

test('activity is bound to the sign-in token and cannot revive a different expired session', async () => {
  const f = await fixture();
  const renewal = f.cookies();
  await f.context.run(renewal, () => f.server.requireSession());
  apply(f.jar, renewal);
  const primary = await iron.unsealData<{ auth: Record<string, string>; createdAt: number; lastSeenAt: number }>(f.jar.get('og_session')!, { password });
  primary.auth['access-token'] = 'another-sign-in-token';
  primary.createdAt = primary.lastSeenAt = Date.now() - 9 * 60 * 60_000;
  f.jar.set('og_session', await iron.sealData(primary, { password, ttl: 86400 }));
  await assert.rejects(f.context.run(f.cookies(), () => f.server.requireSession()), { status: 401 });
});

test('late activity renewal cannot restore login after logout during an engine outage', async () => {
  const f = await fixture();
  const slowCookies = f.cookies();
  const slow = f.context.run(slowCookies, () => f.workspace.GET(request('/api/workspace/contacts'), { params: Promise.resolve({ path: ['contacts'] }) }));
  await f.started.promise;
  const logoutCookies = f.cookies();
  const response = await f.context.run(logoutCookies, () => f.logout.POST(request('/api/auth/logout', 'POST', {})));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).revoked, false);
  apply(f.jar, logoutCookies);
  f.release.resolve(); await slow;
  apply(f.jar, slowCookies);
  const active = await f.context.run(f.cookies(), async () => f.server.sessionIsActive(await f.server.session()));
  assert.equal(active, false, 'A late response must not recreate the destroyed authenticated session');
});
