import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'omnigrow-production-test-'));
  await mkdir(join(root, 'scripts')); await mkdir(join(root, '.local'));
  for (const file of ['prepare-production.mjs', 'meeting-production.mjs']) await copyFile(`scripts/${file}`, join(root, 'scripts', file));
  await writeFile(join(root, '.local/engine.env'), 'FRONTEND_URL=http://localhost:3001\nFORCE_SSL=false\n');
  await writeFile(join(root, '.local/livekit.yaml'), 'port: 7880\nrtc:\n  node_ip: 127.0.0.1\nroom:\n  auto_create: false\nkeys:\n  acceptance-key: acceptance-only-secret\n');
  for (const [name, days] of [['valid', '30'], ['short', '1']]) {
    const result = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', days, '-subj', '/CN=turn.example.com', '-addext', 'subjectAltName=DNS:turn.example.com', '-keyout', join(root, `${name}.key`), '-out', join(root, `${name}.pem`)], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const env = { ...process.env, OG_APP_HOST: 'app.example.com', OG_MESSAGING_HOST: 'messages.example.com', OG_MEETINGS_HOST: 'meet.example.com', OG_TURN_HOST: 'turn.example.com', OG_VPS_PUBLIC_IP: '93.184.216.34', OG_TURN_CERT_FILE: join(root, 'valid.pem'), OG_TURN_KEY_FILE: join(root, 'valid.key') };
  const prepare = (overrides: Partial<NodeJS.ProcessEnv> = {}) => spawnSync(process.execPath, [join(root, 'scripts/prepare-production.mjs')], { encoding: 'utf8', env: { ...env, ...overrides } });
  return { root, prepare };
}

test('production preparation rejects unusable meeting identity and certificates before writing configuration', async () => {
  const { root, prepare } = await fixture();
  try {
    for (const overrides of [
      { OG_VPS_PUBLIC_IP: '192.168.1.10' },
      { OG_MEETINGS_HOST: 'app.example.com' },
      { OG_TURN_HOST: 'wrong.example.com' },
      { OG_TURN_KEY_FILE: join(root, 'short.key') },
      { OG_TURN_CERT_FILE: join(root, 'short.pem'), OG_TURN_KEY_FILE: join(root, 'short.key') }
    ]) {
      assert.notEqual(prepare(overrides).status, 0);
      assert.deepEqual((await readdir(join(root, '.local'))).sort(), ['engine.env', 'livekit.yaml']);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('production preparation preserves admission controls, installs matching certificate bytes and refuses overwrite', async () => {
  const { root, prepare } = await fixture();
  try {
    const result = prepare(); assert.equal(result.status, 0, result.stderr);
    const paths = ['production.env', 'app.production.env', 'engine.production.env', 'livekit.production.yaml', 'turn-certs/fullchain.pem', 'turn-certs/privkey.pem'];
    const before = new Map<string, Buffer>();
    for (const path of paths) {
      before.set(path, await readFile(join(root, '.local', path)));
      assert.equal((await stat(join(root, '.local', path))).mode & 0o777, 0o600);
    }
    const media = before.get('livekit.production.yaml')!.toString();
    assert.match(media, /node_ip: 93\.184\.216\.34/); assert.match(media, /auto_create: false/);
    assert.match(media, /tls_port: 5349/); assert.match(media, /domain: turn\.example\.com/);
    assert.match(before.get('engine.production.env')!.toString(), /OG_MEETING_URL=wss:\/\/meet\.example\.com/);
    assert.deepEqual(before.get('turn-certs/fullchain.pem'), await readFile(join(root, 'valid.pem')));
    assert.deepEqual(before.get('turn-certs/privkey.pem'), await readFile(join(root, 'valid.key')));
    assert.notEqual(prepare().status, 0);
    for (const [path, bytes] of before) assert.deepEqual(await readFile(join(root, '.local', path)), bytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});
