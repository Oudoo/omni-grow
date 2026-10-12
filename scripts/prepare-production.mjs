import { readFile, writeFile, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const appHost = process.env.OG_APP_HOST, messagingHost = process.env.OG_MESSAGING_HOST;
const hostname = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
if (process.env.INSTAGRAM_APP_ID && !/^\d+$/.test(process.env.INSTAGRAM_APP_ID)) throw new Error('INSTAGRAM_APP_ID must be the numeric provider app ID.');
if (!appHost || !messagingHost || !hostname.test(appHost) || !hostname.test(messagingHost) || appHost === messagingHost) throw new Error('Set distinct OG_APP_HOST and OG_MESSAGING_HOST DNS hostnames before preparing production.');
// Do not overwrite an operator's existing configuration.
for (const path of ['.local/production.env', '.local/app.production.env', '.local/engine.production.env']) if (await access(path).then(() => true, () => false)) throw new Error(`${path} already exists. Review and update it directly rather than replacing it.`);
const engine = await readFile('.local/engine.env', 'utf8');
if (!/^FRONTEND_URL=.+$/m.test(engine) || !/^FORCE_SSL=.+$/m.test(engine)) throw new Error('Engine configuration is missing FRONTEND_URL or FORCE_SSL. Run setup before preparing production.');
await writeFile('.local/production.env', `OG_APP_HOST=${appHost}\nOG_MESSAGING_HOST=${messagingHost}\n`, { mode: 0o600, flag: 'wx' });
await writeFile('.local/app.production.env', `SESSION_SECRET=${randomBytes(32).toString('hex')}\nTRUST_PROXY=true\nINSTAGRAM_APP_ID=${process.env.INSTAGRAM_APP_ID || ''}\n`, { mode: 0o600, flag: 'wx' });
// The production overlay changes public URLs without altering development configuration.
await writeFile('.local/engine.production.env', `FRONTEND_URL=https://${messagingHost}\nFORCE_SSL=false\n`, { mode: 0o600, flag: 'wx' });
console.log('Production configuration prepared. Set DNS, configure provider credentials and SMTP privately, then run the deployment commands in docs/DEPLOYMENT.md. No deployment was started.');
