import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Install Node.js 24 LTS before starting OmniGrow.');
try { await access('node_modules/next/dist/bin/next'); }
catch { throw new Error('Dependencies are missing. Run npm ci, then npm run local.'); }
async function run(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Local startup failed (${code}). Read the error above; existing data was retained.`)));
  });
}
await run(process.execPath, ['scripts/setup.mjs']);
console.log('Open the local workspace on port 3000. Initial sign-in details are in .local/bootstrap-credentials.json.');
console.log('To display them privately in another terminal, run npm run local:credentials.');
console.log('Ctrl+C stops the frontend. npm run services:down stops messaging and retains your data.');
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3000'], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 0; });
