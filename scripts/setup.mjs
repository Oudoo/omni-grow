import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { restoreSnapshot, assertNoInterruptedRestore } from './restore-snapshot.mjs';
import { configureProviders } from './provider-env.mjs';
import { composeArgs, compactMode, docker, engineServices } from './docker.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
await mkdir('.local', { recursive: true, mode: 0o700 });
await assertNoInterruptedRestore();
const exists = async path => access(path).then(() => true, () => false);
const hex = size => randomBytes(size).toString('hex');

if (!await exists('.env.local')) {
  await writeFile('.env.local', `APP_URL=http://localhost:3000\nENGINE_URL=http://127.0.0.1:3001\nNEXT_PUBLIC_ENGINE_URL=http://localhost:3001\nSESSION_SECRET=${hex(32)}\n# CSP_MODE=report-only|enforce|off (see docs/DEPLOYMENT.md)\nCSP_MODE=report-only\n`, { mode: 0o600, flag: 'wx' });
}
if (!await exists('.local/engine.env')) {
  const postgres = hex(24), redis = hex(24);
  await writeFile('.local/engine.env', `SECRET_KEY_BASE=${hex(64)}\nACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY=${hex(16)}\nACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY=${hex(16)}\nACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT=${hex(16)}\nFRONTEND_URL=http://localhost:3001\nFORCE_SSL=false\nENABLE_ACCOUNT_SIGNUP=false\nPOSTGRES_HOST=postgres\nPOSTGRES_DATABASE=chatwoot\nPOSTGRES_DB=chatwoot\nPOSTGRES_USERNAME=postgres\nPOSTGRES_USER=postgres\nPOSTGRES_PASSWORD=${postgres}\nREDIS_URL=redis://redis:6379\nREDIS_PASSWORD=${redis}\nACTIVE_STORAGE_SERVICE=local\nRAILS_LOG_TO_STDOUT=true\nRAILS_MAX_THREADS=5\nSIDEKIQ_CONCURRENCY=5\nINSTALLATION_NAME=OmniGrow\nDISABLE_TELEMETRY=true\nMAXIMUM_FILE_UPLOAD_SIZE=20\nLOGRAGE_ENABLED=true\n`, { mode: 0o600, flag: 'wx' });
}
// The initial owner credentials file is only needed until the owner exists. After the first
// sign-in and password change, operators may delete it; repeat runs then use bootstrap-state.json.
const hasBootstrapState = await exists('.local/bootstrap-state.json');
if (!hasBootstrapState && !await exists('.local/bootstrap-credentials.json')) {
  await writeFile('.local/bootstrap-credentials.json', JSON.stringify({
    email: process.env.OG_OWNER_EMAIL || 'owner@omnigrow.local',
    password: randomBytes(24).toString('base64url') + 'aA1!',
    name: process.env.OG_OWNER_NAME || 'Workspace owner',
    workspace: process.env.OG_WORKSPACE_NAME || 'OmniGrow'
  }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}
await configureProviders();
if (!await exists('.local/runtime.json') && process.env.OG_PRODUCTION !== '1') {
  const driver = await docker(['info', '--format', '{{.Driver}}'], { capture: true });
  await writeFile('.local/runtime.json', JSON.stringify({ compact: process.env.OG_COMPACT === '1' || (process.env.OG_COMPACT !== '0' && driver === 'vfs') }) + '\n', { mode: 0o600, flag: 'wx' });
}
async function run(args, options = {}) {
  return await new Promise((resolve, reject) => {
    let output = '';
    const child = spawn('docker', composeArgs(args), { stdio: ['pipe', options.capture ? 'pipe' : 'inherit', 'inherit'] });
    if (options.capture) child.stdout.on('data', chunk => { output += chunk; });
    if (options.input) child.stdin.end(options.input); else child.stdin.end();
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(`docker compose ${args[0]} exited ${code}`)));
  });
}
await run(['up', '-d', '--wait', '--wait-timeout', '120', 'postgres', 'redis']);
await restoreSnapshot();
const runningRails = (await run(['ps', '--status', 'running', '-q', 'rails'], { capture: true })).trim();
const runner = runningRails ? ['exec', '-T', 'rails'] : ['run', '--rm', '-T', 'rails'];
await run([...runner, 'bundle', 'exec', 'rails', 'db:chatwoot_prepare']);
const credentials = {};
if (await exists('.local/bootstrap-credentials.json')) Object.assign(credentials, JSON.parse(await readFile('.local/bootstrap-credentials.json', 'utf8')));
if (hasBootstrapState) Object.assign(credentials, JSON.parse(await readFile('.local/bootstrap-state.json', 'utf8')));
// The owner also administers the engine installation (super admin) unless OG_SUPER_ADMIN=0.
credentials.super_admin = process.env.OG_SUPER_ADMIN !== '0';
const bootstrap = await run([...runner, 'bundle', 'exec', 'rails', 'runner', '/app/omnigrow-bootstrap.rb'], { input: JSON.stringify(credentials), capture: true });
const provisioned = bootstrap.split('\n').find(line => line.startsWith('OG_BOOTSTRAP_JSON:'));
if (!provisioned) throw new Error('Initial owner provisioning did not confirm its identity. Inspect the engine before retrying.');
await writeFile('.local/bootstrap-state.json', provisioned.slice('OG_BOOTSTRAP_JSON:'.length) + '\n', { mode: 0o600 });
let desiredCompactHash;
if (compactMode()) {
  await run(['stop', 'worker']);
  await run(['rm', '-f', 'worker']);
  desiredCompactHash = (await run(['config', '--hash', 'rails'], { capture: true })).trim().split(/\s+/).at(-1);
  if (runningRails) {
    const actualHash = await docker(['inspect', '--format', '{{index .Config.Labels "com.docker.compose.config-hash"}}', runningRails], { capture: true });
    const previous = JSON.parse(await readFile('.local/runtime.json', 'utf8')).railsConfig;
    // Compose's config hash and up-label hash can differ (normalized dependency
    // fields). Retain both from the last successful start rather than repeatedly
    // recreating an unchanged multi-gigabyte VFS layer.
    if (actualHash !== desiredCompactHash && (previous?.desired !== desiredCompactHash || previous?.actual !== actualHash)) {
      // Release the old VFS copy before creating the combined local service.
      await run(['stop', 'rails']);
      await run(['rm', '-f', 'rails']);
    }
  }
}
await run(['up', '-d', '--wait', '--wait-timeout', '180', ...engineServices()]);
if (desiredCompactHash) {
  const id = (await run(['ps', '-q', 'rails'], { capture: true })).trim();
  const actual = await docker(['inspect', '--format', '{{index .Config.Labels "com.docker.compose.config-hash"}}', id], { capture: true });
  const runtime = JSON.parse(await readFile('.local/runtime.json', 'utf8'));
  await writeFile('.local/runtime.json', JSON.stringify({ ...runtime, railsConfig: { desired: desiredCompactHash, actual } }) + '\n', { mode: 0o600 });
}
const deadline = Date.now() + 180_000;
let ready = false;
while (Date.now() < deadline) {
  try {
    const response = await fetch('http://127.0.0.1:3001/api', { signal: AbortSignal.timeout(5000) });
    if (response.ok) { ready = true; break; }
  } catch { /* Backend is still starting. */ }
  await new Promise(resolve => setTimeout(resolve, 2000));
}
if (!ready) throw new Error('Messaging backend did not become ready. Inspect docker compose logs rails worker.');
console.log(hasBootstrapState
  ? 'Messaging backend ready. The existing owner was retained. Start OmniGrow with npm run dev.'
  : 'Messaging backend ready. Owner credentials are in .local/bootstrap-credentials.json (not printed). Start OmniGrow with npm run dev.');
