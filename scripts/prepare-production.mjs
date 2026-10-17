import { readFile, writeFile, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { meetingSettings, validatedCertificate, installMeetingCertificate, productionMeetingConfig } from './meeting-production.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const appHost = process.env.OG_APP_HOST, messagingHost = process.env.OG_MESSAGING_HOST;
const hostname = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
if (process.env.INSTAGRAM_APP_ID && !/^\d+$/.test(process.env.INSTAGRAM_APP_ID)) throw new Error('INSTAGRAM_APP_ID must be the numeric provider app ID.');
if (!appHost || !messagingHost || !hostname.test(appHost) || !hostname.test(messagingHost) || appHost === messagingHost) throw new Error('Set distinct OG_APP_HOST and OG_MESSAGING_HOST DNS hostnames before preparing production.');
const meetings = meetingSettings(process.env);
const certificate = await validatedCertificate(meetings.turnHost, meetings.certificate, meetings.key);
const livekit = await productionMeetingConfig(meetings);
// Do not overwrite an operator's existing configuration.
for (const path of ['.local/production.env', '.local/app.production.env', '.local/engine.production.env', '.local/livekit.production.yaml']) if (await access(path).then(() => true, () => false)) throw new Error(`${path} already exists. Review and update it directly rather than replacing it.`);
const engine = await readFile('.local/engine.env', 'utf8');
if (!/^FRONTEND_URL=.+$/m.test(engine) || !/^FORCE_SSL=.+$/m.test(engine)) throw new Error('Engine configuration is missing FRONTEND_URL or FORCE_SSL. Run setup before preparing production.');
await writeFile('.local/production.env', [
  `OG_APP_HOST=${appHost}`,
  `OG_MESSAGING_HOST=${messagingHost}`,
  `OG_MEETINGS_HOST=${meetings.host}`,
  `OG_TURN_HOST=${meetings.turnHost}`,
  `OG_VPS_PUBLIC_IP=${meetings.ip}`,
  `OG_SERVICE_UID=${process.getuid?.() ?? 1000}`,
  `OG_SERVICE_GID=${process.getgid?.() ?? 1000}`,
  '# One IP or CIDR allowed to reach /api/health on the app host (uptime monitor). Default: nobody from outside.',
  'OG_MONITOR_IPS=127.0.0.1',
  '# One IP or CIDR allowed to reach the engine installation console (/super_admin, /monitoring). Default: nobody from outside.',
  'OG_ADMIN_IPS=127.0.0.1',
  ''
].join('\n'), { mode: 0o600, flag: 'wx' });
await writeFile('.local/app.production.env', [
  `SESSION_SECRET=${randomBytes(32).toString('hex')}`,
  'TRUST_PROXY=true',
  `INSTAGRAM_APP_ID=${process.env.INSTAGRAM_APP_ID || ''}`,
  '# Content Security Policy: start in report-only, watch "content security policy violation" log lines, then set enforce.',
  'CSP_MODE=report-only',
  '# Extra image/connect origins for the policy, space separated (for example an object storage host for attachments).',
  '# CSP_IMAGE_SOURCES=',
  `CSP_CONNECT_SOURCES=https://${meetings.host} wss://${meetings.host}`,
  '# Live event streams allowed per sign-in (browser tabs).',
  'REALTIME_MAX_STREAMS=6',
  ''
].join('\n'), { mode: 0o600, flag: 'wx' });
// The production overlay changes public URLs without altering development configuration.
await writeFile('.local/engine.production.env', [
  `FRONTEND_URL=https://${messagingHost}`,
  'FORCE_SSL=false',
  `OG_MEETING_URL=wss://${meetings.host}`,
  '# Two Puma processes with five threads each; raise with host memory.',
  'WEB_CONCURRENCY=2',
  'RAILS_MAX_THREADS=5',
  '# Error reporting (optional).',
  '# SENTRY_DSN=',
  '# Office or VPN egress addresses exempt from the engine rate limits, comma separated (use sparingly).',
  '# RACK_ATTACK_ALLOWED_IPS=',
  '# Object storage for attachments instead of the local volume (see docs/DEPLOYMENT.md).',
  '# ACTIVE_STORAGE_SERVICE=s3_compatible',
  ''
].join('\n'), { mode: 0o600, flag: 'wx' });
await writeFile('.local/livekit.production.yaml', livekit, { mode: 0o600, flag: 'wx' });
await installMeetingCertificate(certificate);
console.log('Production configuration prepared. Set DNS, configure provider credentials and SMTP privately, then run the deployment commands in docs/DEPLOYMENT.md. No deployment was started.');
