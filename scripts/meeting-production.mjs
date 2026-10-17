import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { isIP } from 'node:net';

export function meetingSettings(env) {
  const hostname = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
  const host = env.OG_MEETINGS_HOST, turnHost = env.OG_TURN_HOST, ip = env.OG_VPS_PUBLIC_IP;
  if (!host || !turnHost || !hostname.test(host) || !hostname.test(turnHost) || new Set([host, turnHost, env.OG_APP_HOST, env.OG_MESSAGING_HOST]).size !== 4) throw new Error('Set distinct OG_MEETINGS_HOST and OG_TURN_HOST DNS hostnames alongside the app and messaging hostnames.');
  if (!ip || isIP(ip) !== 4 || /^(0|10|127|169\.254|192\.168)\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || Number(ip.split('.')[0]) >= 224) throw new Error('OG_VPS_PUBLIC_IP must be the VPS public IPv4 address used for real-time media.');
  if (!env.OG_TURN_CERT_FILE || !env.OG_TURN_KEY_FILE) throw new Error('Set OG_TURN_CERT_FILE (full certificate chain) and OG_TURN_KEY_FILE for OG_TURN_HOST before preparing production meetings.');
  return { host, turnHost, ip, certificate: env.OG_TURN_CERT_FILE, key: env.OG_TURN_KEY_FILE };
}
export async function validatedCertificate(host, certificatePath, keyPath) {
  const certificate = await readFile(certificatePath), key = await readFile(keyPath);
  const parsed = new X509Certificate(certificate);
  if (!parsed.checkHost(host) || !parsed.checkPrivateKey(createPrivateKey(key))) throw new Error('The TURN certificate, hostname and private key must match.');
  if (Date.parse(parsed.validFrom) > Date.now() || Date.parse(parsed.validTo) < Date.now() + 7 * 86400000) throw new Error('The TURN certificate must be valid now and for at least another seven days.');
  return { certificate, key };
}
export async function installMeetingCertificate(bundle) {
  await mkdir('.local/turn-certs', { recursive: true, mode: 0o700 });
  for (const [name, content] of [['fullchain.pem', bundle.certificate], ['privkey.pem', bundle.key]]) {
    await writeFile(`.local/turn-certs/${name}.new`, content, { mode: 0o600 });
    await rename(`.local/turn-certs/${name}.new`, `.local/turn-certs/${name}`);
  }
}
export async function productionMeetingConfig(settings) {
  const local = await readFile('.local/livekit.yaml', 'utf8');
  if (!/auto_create: false/.test(local) || !/node_ip: 127\.0\.0\.1/.test(local)) throw new Error('Local meeting configuration has changed; review the production media configuration manually.');
  return local.replace('node_ip: 127.0.0.1', `node_ip: ${settings.ip}`) + [
    'turn:', '  enabled: true', `  domain: ${settings.turnHost}`, '  udp_port: 3478', '  tls_port: 5349',
    '  relay_range_start: 50000', '  relay_range_end: 50199', '  cert_file: /etc/omnigrow-turn/fullchain.pem', '  key_file: /etc/omnigrow-turn/privkey.pem', ''
  ].join('\n');
}
