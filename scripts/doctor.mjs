import { access, statfs } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compactMode, compose, engineServices } from './docker.mjs';
import { assertNoInterruptedRestore } from './restore-snapshot.mjs';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
let failed = false;
for (const file of ['.env.local', '.local/engine.env', '.local/bootstrap-state.json', '.local/bootstrap-credentials.json']) {
  const exists = await access(file).then(() => true, () => false);
  console.log(`${exists ? 'OK' : 'MISSING'} ${file}`);
  if (!exists) failed = true;
}
console.log(`Messaging layout: ${compactMode() ? 'compact local web + worker' : 'separate web and worker'}`);
try {
  await assertNoInterruptedRestore();
  const output = await compose(['ps', '--all', '--format', 'json'], { capture: true });
  const containers = output.startsWith('[') ? JSON.parse(output) : output.split('\n').filter(Boolean).map(line => JSON.parse(line));
  for (const service of ['postgres', 'redis', ...engineServices()]) {
    const container = containers.find(item => item.Service === service);
    const ready = container?.State === 'running' && (!container.Health || container.Health === 'healthy');
    console.log(`${ready ? 'OK' : 'NOT READY'} ${service} (${container?.Health || container?.State || 'missing'})`);
    if (!ready) failed = true;
  }
} catch (error) { console.log(error.message); failed = true; }
for (const [name, url] of [['Messaging', 'http://127.0.0.1:3001/api'], ['Workspace', 'http://127.0.0.1:3000/api/health']]) {
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
