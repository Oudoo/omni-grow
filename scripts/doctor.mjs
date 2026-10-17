import { access, statfs } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compactMode, compose, engineServices } from './docker.mjs';
import { assertNoInterruptedRestore } from './restore-snapshot.mjs';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
let failed = false;
const exists = async file => access(file).then(() => true, () => false);
for (const file of ['.env.local', '.local/engine.env', '.local/bootstrap-state.json', '.local/livekit.yaml']) {
  const ok = await exists(file);
  console.log(`${ok ? 'OK' : 'MISSING'} ${file}`);
  if (!ok) failed = true;
}
// The initial credentials file is optional once the owner exists; deleting it after the first sign-in is recommended.
console.log(`${await exists('.local/bootstrap-credentials.json') ? 'PRESENT' : 'REMOVED'} .local/bootstrap-credentials.json (optional after first sign-in)`);
console.log(`Messaging layout: ${compactMode() ? 'compact local web + worker' : 'separate web and worker'}`);
try {
  await assertNoInterruptedRestore();
  const output = await compose(['ps', '--all', '--format', 'json'], { capture: true });
  const containers = output.startsWith('[') ? JSON.parse(output) : output.split('\n').filter(Boolean).map(line => JSON.parse(line));
  for (const service of ['postgres', 'redis', ...engineServices(), 'meetings']) {
    const container = containers.find(item => item.Service === service);
    const ready = container?.State === 'running' && (!container.Health || container.Health === 'healthy');
    console.log(`${ready ? 'OK' : 'NOT READY'} ${service} (${container?.Health || container?.State || 'missing'})`);
    if (!ready) failed = true;
  }
} catch (error) { console.log(error.message); failed = true; }
for (const [name, url] of [['Messaging', 'http://127.0.0.1:3001/health'], ['Workspace', 'http://127.0.0.1:3000/api/health'], ['Meetings', 'http://127.0.0.1:7880/']]) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const ready = response.ok && (name !== 'Workspace' || (await response.json()).messaging === 'reachable');
    console.log(`${ready ? 'OK' : 'NOT READY'} ${name}`);
    if (!ready) failed = true;
  } catch { console.log(`NOT RUNNING ${name}`); failed = true; }
}
const disk = await statfs('.');
console.log(`Free disk: ${(disk.bavail * disk.bsize / 1024 ** 3).toFixed(1)} GiB`);
process.exitCode = failed ? 1 : 0;
