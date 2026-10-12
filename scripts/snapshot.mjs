import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compose, engineServices } from './docker.mjs';
import { sha256 } from './files.mjs';
import { assertNoInterruptedRestore } from './restore-snapshot.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
await assertNoInterruptedRestore();
const staging = `.local/snapshot-${Date.now()}`;
await mkdir(staging, { recursive: true, mode: 0o700 });
try {
  console.log('Pausing the messaging service while saving its database, attachments, and durable queue.');
  await compose(['stop', ...engineServices(), 'redis']);
  await compose(['exec', '-T', 'postgres', 'pg_dump', '-U', 'postgres', '-Fc', 'chatwoot'], { output: `${staging}/database.dump` });
  await compose(['run', '--rm', '-T', '--no-deps', '--entrypoint', 'tar', 'storage_tools', '-cf', '-', '-C', '/data', '.'], { output: `${staging}/storage.tar`, quiet: true });
  await compose(['run', '--rm', '-T', '--no-deps', '--entrypoint', 'tar', 'redis', '-cf', '-', '-C', '/data', '.'], { output: `${staging}/redis.tar`, quiet: true });
  const files = {};
  for (const name of ['database.dump', 'storage.tar', 'redis.tar']) files[name] = await sha256(`${staging}/${name}`);
  await writeFile(`${staging}/manifest.json`, JSON.stringify({ format: 1, created_at: new Date().toISOString(), files }, null, 2) + '\n', { mode: 0o600 });
  // Keep the last good snapshot until every new artifact is complete.
  await rm('.local/snapshot.previous', { recursive: true, force: true });
  try { await rename('.local/snapshot', '.local/snapshot.previous'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await rename(staging, '.local/snapshot');
  console.log('Reusable messaging state saved in .local/snapshot. Keep .local/engine.env and .env.local private alongside it.');
} finally {
  await assertNoInterruptedRestore();
  await compose(['up', '-d', '--wait', '--wait-timeout', '180', 'redis', ...engineServices()]);
}
