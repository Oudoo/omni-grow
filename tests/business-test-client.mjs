import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { unsealData } from 'iron-session';
export const base = 'http://localhost:3000', engine = 'http://localhost:3001';
const secret = (await readFile('.env.local', 'utf8')).match(/^SESSION_SECRET=(.+)$/m)?.[1].replace(/^['\"]|['\"]$/g, '');
assert(secret);
// A pooled keep-alive connection can be closed by the server at the moment the client reuses it
// (typically after a long pause such as a Rails runner call). The request never reached the
// application, so one retry on a fresh connection is safe and keeps the suite deterministic.
async function send(url, init) {
  try { return await fetch(url, init); }
  catch (error) {
    if (!['UND_ERR_SOCKET', 'ECONNRESET'].includes(error?.cause?.code)) throw error;
    return await fetch(url, init);
  }
}
export class Client {
  constructor() { this.cookies = new Map(); }
  async call(path, method = 'GET', data, expected = 200) {
    const headers = { Origin: base, Cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ') };
    let body;
    if (method !== 'GET') { body = data instanceof FormData ? data : JSON.stringify(data ?? {}); if (!(data instanceof FormData)) headers['Content-Type'] = 'application/json'; }
    const response = await send(`${base}${path}`, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(30000) });
    for (const cookie of response.headers.getSetCookie()) { const [name, ...value] = cookie.split(';')[0].split('='); this.cookies.set(name, value.join('=')); }
    if (!(Array.isArray(expected) ? expected.includes(response.status) : response.status === expected)) {
      const result = await response.json().catch(() => ({}));
      const error = new Error(`${method} ${path} expected ${expected}, got ${response.status}: ${typeof result.error === 'string' ? result.error.slice(0, 400) : 'unexpected response'}`);
      error.status = response.status; error.retryAfter = Number(response.headers.get('retry-after')) || 300;
      throw error;
    }
    if (!response.headers.get('content-type')?.includes('application/json')) return { response, bytes: Buffer.from(await response.arrayBuffer()) };
    const parsed = await response.json();
    return Array.isArray(expected) ? { status: response.status, data: parsed } : parsed;
  }
  async login(email, value) {
    try { await this.call('/api/auth/login', 'POST', { email, password: value }); }
    catch (error) {
      if (error.status !== 429) throw error;
      console.log('Honoring the native sign-in throttle before retrying.');
      let remaining = Math.min(600, error.retryAfter + 1) * 1000;
      while (remaining > 0) { const duration = Math.min(30000, remaining); await new Promise(resolve => setTimeout(resolve, duration)); remaining -= duration; }
      await this.call('/api/auth/login', 'POST', { email, password: value });
    }
    this.state = await unsealData(decodeURIComponent(this.cookies.get('og_session')), { password: secret });
    return this;
  }
  async native(path, method = 'GET', body, expected = 200) {
    const response = await send(`${engine}${path}`, { method, headers: { ...this.state.auth, 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }), redirect: 'manual' });
    assert.equal(response.status, expected, `${method} native ${path}`);
    return response;
  }
  static async restore(saved) { const client = new Client(); for (const cookie of saved.cookies) client.cookies.set(cookie.name, cookie.value); client.state = await unsealData(decodeURIComponent(client.cookies.get('og_session')), { password: secret }); return client; }
  storageState() { return { cookies: [...this.cookies].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax', expires: -1 })), origins: [] }; }
}
