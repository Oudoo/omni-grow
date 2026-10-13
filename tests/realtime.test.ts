import assert from 'node:assert/strict';
import test from 'node:test';
import { deferred, loadModule } from './support/load-module';

function fixture(socketFailure = false) {
  const auth = { uid: 'synthetic-agent', client: 'synthetic-device', 'access-token': 'synthetic-token' };
  const gate = deferred();
  let profileCalls = 0;
  class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
  const server = {
    ApiError, engineUrl: () => 'http://synthetic.invalid',
    requireSession: async () => ({ auth, accountId: 1, createdAt: Date.now(), lastSeenAt: Date.now() }),
    loadProfile: async () => { profileCalls++; await gate.promise; return { id: 1, pubsub_token: 'synthetic', accounts: [{ id: 1 }] }; },
    fail: (error: { status?: number; message: string }) => Response.json({ error: error.message }, { status: error.status || 503 }),
    log: () => {}
  };
  class FakeSocket extends EventTarget {
    static OPEN = 1; readyState = 1;
    constructor() { super(); if (socketFailure) throw new Error('Synthetic WebSocket setup failure'); }
    close() {} send() {}
  }
  const globals = { globalThis: {}, process: { env: { REALTIME_MAX_STREAMS: '6' } }, WebSocket: FakeSocket };
  const registry = loadModule('src/lib/realtime-server.ts', { 'server-only': {}, './server': server }, globals);
  const sessionPolicy = loadModule('src/lib/session-policy.ts', {});
  const route = loadModule('src/app/api/realtime/route.ts', { '@/lib/server': server, '@/lib/policy': { redactSecrets: (value: unknown) => value }, '@/lib/session-policy': sessionPolicy, '@/lib/realtime-server': registry }, globals);
  return { auth, gate, registry, route, profileCalls: () => profileCalls };
}

test('concurrent realtime opens respect the cap and cancellation releases every slot', async () => {
  const f = fixture();
  try {
    const pending = Array.from({ length: 12 }, () => f.route.GET(new Request('http://synthetic.invalid/api/realtime')));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.profileCalls(), 12);
    f.gate.resolve();
    const responses: Response[] = await Promise.all(pending);
    assert.equal(responses.filter(response => response.status === 200).length, 6);
    assert.equal(responses.filter(response => response.status === 429).length, 6);
    assert.equal(f.registry.streamCount(f.auth), 6);
    await Promise.all(responses.map(response => response.body?.cancel()));
    assert.equal(f.registry.streamCount(f.auth), 0);
  } finally { f.registry.closeAllStreams(); }
});

test('failed WebSocket setup does not leak a realtime capacity slot', async () => {
  const f = fixture(true);
  try {
    f.gate.resolve();
    const response = await f.route.GET(new Request('http://synthetic.invalid/api/realtime'));
    assert.equal(response.status, 503);
    assert.equal(f.registry.streamCount(f.auth), 0);
  } finally { f.registry.closeAllStreams(); }
});

test('a request aborted during authorization releases its stream slot', async () => {
  const f = fixture();
  try {
    const controller = new AbortController();
    const pending = f.route.GET(new Request('http://synthetic.invalid/api/realtime', { signal: controller.signal }));
    await new Promise(resolve => setImmediate(resolve));
    controller.abort(); f.gate.resolve();
    const response: Response = await pending;
    assert.equal(await response.text(), '');
    assert.equal(f.registry.streamCount(f.auth), 0);
  } finally { f.registry.closeAllStreams(); }
});
