// Disposable local TLS integration: actual HAProxy + Caddy images and routing
// configuration. The certificate is a test CA, never a production certificate.
import assert from 'node:assert/strict';
import { createServer as httpServer } from 'node:http';
import { createServer as tlsServer, connect } from 'node:tls';
import { request } from 'node:https';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
const name = `og-edge-${randomUUID().slice(0, 8)}`, directory = resolve(`.local/${name}`);
const haproxy = 'haproxy@sha256:254e6370f01cd654e0744edf607c67f33777c1b6a9dc0d4b28bcba7171460122';
const caddy = 'caddy@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d';
function run(command, args, allowFailure = false) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60000 });
  if (result.status && !allowFailure) throw new Error(`${command} ${args[0]} failed: ${result.stderr.slice(-1500)}`);
  return result.stdout.trim();
}
const docker = args => run('docker', args);
let web, turn, networkCreated = false;
const created = [];
try {
  await mkdir(directory, { mode: 0o700 });
  run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '14', '-keyout', `${directory}/key.pem`, '-out', `${directory}/cert.pem`, '-subj', '/CN=app.edge.test', '-addext', 'subjectAltName=DNS:app.edge.test,DNS:messages.edge.test,DNS:meet.edge.test,DNS:turn.edge.test']);
  const cert = await readFile(`${directory}/cert.pem`), key = await readFile(`${directory}/key.pem`);
  web = httpServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ client: req.headers['x-real-ip'], requestId: req.headers['x-request-id'] })); });
  await new Promise(resolve => web.listen(0, '0.0.0.0', resolve));
  turn = tlsServer({ cert, key }, socket => socket.end('OG_TEST_TURN\n'));
  turn.on('tlsClientError', () => {});
  await new Promise(resolve => turn.listen(0, '0.0.0.0', resolve));
  docker(['network', 'create', name]); networkCreated = true;
  const network = JSON.parse(docker(['network', 'inspect', name]))[0];
  const gateway = network.IPAM.Config[0].Gateway;
  let config = await readFile('deploy/Caddyfile', 'utf8');
  for (const variable of ['OG_APP_HOST', 'OG_MESSAGING_HOST', 'OG_MEETINGS_HOST']) config = config.replace(`{$${variable}} {`, `{$${variable}} {\n\ttls /fixtures/cert.pem /fixtures/key.pem`);
  config = config.replaceAll('app:3000', `host.docker.internal:${web.address().port}`).replaceAll('rails:3000', `host.docker.internal:${web.address().port}`);
  await writeFile(`${directory}/Caddyfile`, config, { mode: 0o644 });
  const proxyConfig = (await readFile('deploy/haproxy.cfg', 'utf8')).replace('meetings:5349', `meetings:${turn.address().port}`);
  await writeFile(`${directory}/haproxy.cfg`, proxyConfig, { mode: 0o644 });
  created.push(docker(['run', '-d', '--name', `${name}-caddy`, '--network', name, '--network-alias', 'proxy', '--add-host', 'host.docker.internal:host-gateway', '-e', 'HTTP_PROXY=', '-e', 'HTTPS_PROXY=', '-e', 'http_proxy=', '-e', 'https_proxy=', '-e', 'OG_APP_HOST=app.edge.test', '-e', 'OG_MESSAGING_HOST=messages.edge.test', '-e', 'OG_MEETINGS_HOST=meet.edge.test', '-e', `OG_MONITOR_IPS=${gateway}`, '-e', 'OG_ADMIN_IPS=192.0.2.77', '-v', `${directory}:/fixtures:ro`, caddy, 'caddy', 'run', '--config', '/fixtures/Caddyfile']));
  created.push(docker(['run', '-d', '--name', `${name}-router`, '--user', `${process.getuid()}:${process.getgid()}`, '--network', name, '--add-host', 'meetings:host-gateway', '-p', '127.0.0.1::8443', '-e', 'OG_TURN_HOST=turn.edge.test', '-v', `${directory}/haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro`, haproxy]));
  const port = Number(docker(['port', `${name}-router`, '8443/tcp']).split(':').at(-1));
  const get = (host, path) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, servername: host, path, ca: cert, headers: { Host: host }, timeout: 5000 }, res => { let data = ''; res.on('data', chunk => { data += chunk; }); res.on('end', () => resolve({ status: res.statusCode, data })); });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('TLS request timed out'))); req.end();
  });
  let result;
  for (let i = 0; i < 30; i++) { try { result = await get('app.edge.test', '/api/health'); if (result.status === 200) break; } catch {} await new Promise(resolve => setTimeout(resolve, 500)); }
  assert.equal(result?.status, 200, 'The monitor allowlist must see the real peer IP through the TLS router');
  const headers = JSON.parse(result.data);
  assert.equal(headers.client, gateway, 'PROXYv2 must preserve original visitor IP for rate limits');
  assert(headers.requestId);
  assert.equal((await get('messages.edge.test', '/super_admin')).status, 404, 'Console allowlist must still reject the real peer');
  assert.equal((await get('meet.edge.test', '/twirp/livekit.RoomService/ListRooms')).status, 404, 'The public meeting host must not route administrative API paths');
  const banner = await new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port, servername: 'turn.edge.test', ca: cert, timeout: 5000 });
    let data = ''; socket.on('data', chunk => { data += chunk; }); socket.on('end', () => resolve(data)); socket.on('error', reject); socket.on('timeout', () => socket.destroy(new Error('TURN SNI route timed out')));
  });
  assert.equal(banner, 'OG_TEST_TURN\n', 'TURN SNI must pass encrypted TLS directly to the media listener');
  console.log('PASS real TLS routing: web, TURN SNI, original client IP, console allowlist and private SFU administration.');
  await writeFile('.local/business-edge-results.json', JSON.stringify({ passed: true, clientIpPreserved: true, turnSni: true, publicTurnMediaTested: false }, null, 2));
} finally {
  for (const id of created.reverse()) run('docker', ['rm', '-f', id], true);
  if (networkCreated) run('docker', ['network', 'rm', name], true);
  web?.closeAllConnections(); web?.close(); turn?.close();
  await rm(directory, { recursive: true, force: true });
}
