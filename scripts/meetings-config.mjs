import { randomBytes } from 'node:crypto';
import { readFile, writeFile, access, stat } from 'node:fs/promises';
import { appendMissing } from './provider-env.mjs';

export async function configureMeetings() {
  const path = '.local/livekit.yaml';
  await writeFile('.env', '', { flag: 'a', mode: 0o600 });
  const exists = await access(path).then(() => true, () => false);
  if (!exists) {
    const key = `og_${randomBytes(12).toString('hex')}`;
    const secret = randomBytes(32).toString('hex');
    await writeFile(path, [
      'port: 7880', 'bind_addresses: ["0.0.0.0"]',
      'rtc:', '  tcp_port: 7881', '  udp_port: 7882', '  use_external_ip: false', '  node_ip: 127.0.0.1',
      'room:', '  auto_create: false', '  empty_timeout: 300', '  departure_timeout: 30', '  max_participants: 50',
      'keys:', `  ${key}: ${secret}`,
      'webhook:', `  api_key: ${key}`, '  urls: ["http://rails:3000/omnigrow/meeting-events"]',
      'logging:', '  level: warn', ''
    ].join('\n'), { mode: 0o600, flag: 'wx' });
    await appendMissing('.local/engine.env', [
      ['OG_MEETING_API_KEY', key], ['OG_MEETING_API_SECRET', secret],
      ['OG_MEETING_URL', 'ws://localhost:7880'], ['OG_MEETING_INTERNAL_URL', 'http://meetings:7880']
    ], true);
  } else {
    const engine = await readFile('.local/engine.env', 'utf8');
    if (!/^OG_MEETING_API_KEY=.+$/m.test(engine) || !/^OG_MEETING_API_SECRET=.+$/m.test(engine)) throw new Error('Meeting configuration exists but the engine keys are missing. Restore the matching private engine configuration; do not regenerate keys.');
  }
  const owner = await stat(path);
  await appendMissing('.env', [['OG_SERVICE_UID', String(owner.uid)], ['OG_SERVICE_GID', String(owner.gid)]], true);
  await appendMissing('.env.local', [['CSP_CONNECT_SOURCES', 'ws://localhost:7880 http://localhost:7880']]);
}
