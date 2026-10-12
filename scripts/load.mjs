import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { compose, docker } from './docker.mjs';
import { sealData } from 'iron-session';
import { createRequire } from 'node:module';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const count = Number(process.env.OG_LOAD_CONNECTIONS || 2000);
const samples = Number(process.env.OG_LOAD_SAMPLES || 30);
if (!Number.isInteger(count) || count < 2 || count > 10000 || !Number.isInteger(samples) || samples < 5 || samples > 500) throw new Error('Invalid benchmark size.');
const engine = new URL(process.env.OG_LOAD_ENGINE_URL || 'http://127.0.0.1:3001');
if (!['127.0.0.1', 'localhost'].includes(engine.hostname)) throw new Error('Benchmark is restricted to the local development engine.');
const useSse = process.env.OG_LOAD_SSE !== '0';
const app = new URL(process.env.OG_LOAD_APP_URL || 'http://localhost:3000');
if (!['127.0.0.1', 'localhost'].includes(app.hostname)) throw new Error('Benchmark frontend must also be local.');
createRequire(import.meta.url)('@next/env').loadEnvConfig(process.cwd());
await mkdir('.local', { recursive: true, mode: 0o700 });
const fixturePath = '.local/load-fixture.json';
const sockets = [];
let fixture;
let disconnected = 0;
let streamClient;
let cookie;
async function runner(data) {
  return await new Promise((resolve, reject) => {
    const child = spawn('docker', ['compose', 'exec', '-T', 'rails', 'bundle', 'exec', 'rails', 'runner', '/tmp/omnigrow-load-fixture.rb'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    // Do not print runner output because its successful response contains tokens.
    child.stderr.resume();
    child.stdin.end(JSON.stringify(data));
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(out) : reject(new Error(`Benchmark fixture operation failed (${code}).`)));
  });
}
async function request(path, data, agent = false) {
  const bff = agent && useSse;
  const actualPath = bff ? path.replace(`/api/v1/accounts/${fixture.account_id}/`, '/api/workspace/') : path;
  const response = await fetch(new URL(actualPath, bff ? app : engine), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(bff ? { Cookie: cookie, Origin: app.origin } : agent ? { api_access_token: fixture.api_token } : {}) }, body: JSON.stringify(data), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Benchmark API failed (${response.status}).`);
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}
async function connectStream() {
  const profileResponse = await fetch(new URL('/api/v1/profile', engine), { headers: fixture.auth, signal: AbortSignal.timeout(15000) });
  if (!profileResponse.ok) throw new Error('Native benchmark session did not validate.');
  const profileData = await profileResponse.json(), profile = profileData.data || profileData;
  if (!process.env.SESSION_SECRET) throw new Error('Run setup before benchmarking the authenticated stream.');
  cookie = `og_session=${await sealData({ auth: fixture.auth, profile, accountId: fixture.account_id, issuedAt: Date.now() }, { password: process.env.SESSION_SECRET, ttl: 8 * 60 * 60 })}`;
  const controller = new AbortController();
  const response = await fetch(new URL('/api/realtime', app), { headers: { Cookie: cookie }, signal: controller.signal });
  if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Authenticated benchmark stream was rejected.');
  const pending = new Set();
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const timer = setTimeout(() => readyReject(new Error('Authenticated stream subscription timed out.')), 15000);
  const client = {
    close: () => controller.abort(),
    wait(predicate) {
      let item;
      const promise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(item); reject(new Error('Expected authenticated event did not arrive.')); }, 15000);
        item = { predicate, resolve: message => { clearTimeout(timer); resolve({ message, at: performance.now() }); }, reject: error => { clearTimeout(timer); reject(error); } }; pending.add(item);
      });
      promise.catch(() => {});
      return promise;
    }
  };
  streamClient = client;
  (async () => {
    const decoder = new TextDecoder(); let buffer = '';
    try {
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const type = frame.split('\n').find(line => line.startsWith('event: '))?.slice(7);
          const data = frame.split('\n').find(line => line.startsWith('data: '))?.slice(6);
          if (type === 'ready') { clearTimeout(timer); readyResolve(client); }
          if (type === 'message' && data) {
            const message = JSON.parse(data);
            for (const item of pending) if (item.predicate(message)) { pending.delete(item); item.resolve(message); }
          }
        }
      }
      if (!controller.signal.aborted) throw new Error('Authenticated stream ended during measurement.');
    } catch (error) {
      if (!controller.signal.aborted) { disconnected++; readyReject(error); for (const item of pending) item.reject(error); pending.clear(); }
    } finally { clearTimeout(timer); }
  })();
  return ready;
}
async function stats() {
  const names = await compose(['ps', '-q', 'rails', 'worker', 'postgres', 'redis'], { capture: true });
  return await docker(['stats', '--no-stream', '--format', '{{json .}}', ...names.split(/\s+/)], { capture: true });
}
function connect(params) {
  return new Promise((resolve, reject) => {
    const url = new URL('/cable', engine); url.protocol = engine.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url, 'actioncable-v1-json'); sockets.push(socket);
    const identifier = JSON.stringify({ channel: 'RoomChannel', ...params });
    const pending = new Set();
    let ready = false;
    const timeout = setTimeout(() => { socket.close(); reject(new Error('WebSocket subscription timed out.')); }, 45000);
    const client = {
      socket, identifier,
      wait(predicate) {
        let item;
        const promise = new Promise((done, fail) => {
          const timer = setTimeout(() => { pending.delete(item); fail(new Error('Expected real-time event did not arrive.')); }, 15000);
          item = { predicate, done: event => { clearTimeout(timer); done(event); }, fail: error => { clearTimeout(timer); fail(error); } };
          pending.add(item);
        });
        // The request and the event may fail independently; attach a handler now.
        promise.catch(() => {});
        return promise;
      }
    };
    socket.addEventListener('open', () => socket.send(JSON.stringify({ command: 'subscribe', identifier })));
    socket.addEventListener('message', event => {
      const frame = JSON.parse(event.data);
      if (frame.type === 'confirm_subscription') { ready = true; clearTimeout(timeout); resolve(client); }
      if (frame.type === 'reject_subscription') { clearTimeout(timeout); reject(new Error('Real-time subscription was rejected.')); }
      if (frame.message) for (const item of pending) if (item.predicate(frame.message)) { pending.delete(item); item.done({ message: frame.message, at: performance.now() }); }
    });
    socket.addEventListener('error', () => { if (!ready) { clearTimeout(timeout); reject(new Error('WebSocket connection failed.')); } });
    socket.addEventListener('close', () => {
      if (ready) disconnected++;
      else { clearTimeout(timeout); reject(new Error('WebSocket closed before subscribing.')); }
      for (const item of pending) item.fail(new Error('WebSocket disconnected.'));
      pending.clear();
    });
  });
}
const percentile = (values, fraction) => Number([...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1].toFixed(2));
try {
  const container = await compose(['ps', '-q', 'rails'], { capture: true });
  if (!container) throw new Error('Start the local engine before benchmarking.');
  await docker(['cp', 'scripts/load-fixture.rb', `${container}:/tmp/omnigrow-load-fixture.rb`]);
  const output = await runner({ action: 'create', count });
  const line = output.split('\n').find(value => value.startsWith('OG_LOAD_JSON:'));
  if (!line) throw new Error('Benchmark fixture response is missing.');
  fixture = JSON.parse(line.slice('OG_LOAD_JSON:'.length));
  await writeFile(fixturePath, JSON.stringify(fixture), { mode: 0o600, flag: 'wx' });
  const resourcesBefore = await stats();
  const clients = [];
  for (let offset = 0; offset < fixture.contacts.length; offset += 50) {
    clients.push(...await Promise.all(fixture.contacts.slice(offset, offset + 50).map(contact => connect({ pubsub_token: contact.pubsub_token }))));
    if ((clients.length + 1) % 500 === 0 || clients.length === fixture.contacts.length) console.log(`${clients.length} contact subscriptions confirmed.`);
  }
  const agent = await connect({ pubsub_token: fixture.user_pubsub_token, user_id: fixture.user_id, account_id: fixture.account_id });
  const recipient = useSse ? await connectStream() : agent;
  if (disconnected || sockets.some(socket => socket.readyState !== WebSocket.OPEN)) throw new Error('Connections dropped while establishing the benchmark.');
  console.log(`${count + (useSse ? 1 : 0)} real ActionCable subscriptions active${useSse ? ', including one authenticated app event stream' : ''}. Measuring actual API requests and delivery.`);
  const target = fixture.contacts[0];
  const contactPath = `/public/api/v1/inboxes/${fixture.identifier}/contacts/${target.source_id}/conversations`;
  const conversation = await request(contactPath, {});
  const publicPath = `${contactPath}/${conversation.id}`;
  const agentPath = `/api/v1/accounts/${fixture.account_id}/conversations/${conversation.id}`;
  const measurements = { incoming_message: [], outgoing_message: [], customer_typing: [], agent_typing: [], agent_presence: [] };
  async function measure(key, recipient, predicate, action) {
    const event = recipient.wait(predicate);
    const started = performance.now();
    await action();
    const received = await event;
    measurements[key].push(received.at - started);
  }
  for (let i = 0; i < samples; i++) {
    const incoming = `benchmark-in-${i}-${Date.now()}`, outgoing = `benchmark-out-${i}-${Date.now()}`;
    await measure('incoming_message', recipient, event => event.event === 'message.created' && event.data?.content === incoming, () => request(`${publicPath}/messages`, { content: incoming }));
    await measure('outgoing_message', clients[0], event => event.event === 'message.created' && event.data?.content === outgoing, () => request(`${agentPath}/messages`, { content: outgoing, message_type: 'outgoing', private: false }, true));
    const status = i % 2 ? 'off' : 'on', type = `conversation.typing_${status}`;
    await measure('customer_typing', recipient, event => event.event === type, () => request(`${publicPath}/toggle_typing`, { typing_status: status }));
    await measure('agent_typing', clients[0], event => event.event === type, () => request(`${agentPath}/toggle_typing_status`, { typing_status: status }, true));
    await measure('agent_presence', recipient, event => event.event === 'presence.update', () => agent.socket.send(JSON.stringify({ command: 'message', identifier: agent.identifier, data: JSON.stringify({ action: 'update_presence' }) })));
  }
  if (disconnected || sockets.filter(socket => socket.readyState === WebSocket.OPEN).length !== count) throw new Error('Connections dropped during measurement.');
  const latency = Object.fromEntries(Object.entries(measurements).map(([key, values]) => [key, { samples: values.length, p50_ms: percentile(values, .5), p95_ms: percentile(values, .95), max_ms: percentile(values, 1) }]));
  const result = { at: new Date().toISOString(), connections: count + (useSse ? 1 : 0), authenticated_app_streams: useSse ? 1 : 0, active_messages: 'one conversation, sequential HTTP operations with other contacts idle', latency, resources_before: resourcesBefore.split('\n').map(line => JSON.parse(line)), resources_loaded: (await stats()).split('\n').map(line => JSON.parse(line)), under_100ms_for_all_samples: Object.values(latency).every(value => value.max_ms < 100) };
  await writeFile(`.local/load-result${useSse ? '-sse' : ''}.json`, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ connections: result.connections, authenticated_app_streams: result.authenticated_app_streams, latency, under_100ms_for_all_samples: result.under_100ms_for_all_samples }, null, 2));
  if (!result.under_100ms_for_all_samples) {
    console.log('The strict <100ms threshold was not met. Results are measurements, not a production SLA.');
    if (process.env.OG_LOAD_ENFORCE_LATENCY === '1') process.exitCode = 1;
  }
} finally {
  streamClient?.close();
  for (const socket of sockets) if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
  if (fixture) {
    const cleanup = await runner({ action: 'destroy', account_id: fixture.account_id, user_id: fixture.user_id });
    if (!cleanup.includes('OG_LOAD_CLEANED')) throw new Error('Benchmark cleanup did not complete.');
    await rm(fixturePath, { force: true });
    await compose(['exec', '-T', 'rails', 'rm', '-f', '/tmp/omnigrow-load-fixture.rb']);
  }
}
