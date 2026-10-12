import { access, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compose, composeArgs } from './docker.mjs';
import { sha256 } from './files.mjs';

export async function assertNoInterruptedRestore() {
  composeArgs([]); // Validate the project name before constructing a marker path.
  const marker = `.local/restore-in-progress-${process.env.OG_COMPOSE_PROJECT || 'omnigrow'}.json`;
  if (await access(marker).then(() => true, () => false)) throw new Error(`An interrupted restore is recorded in ${marker}. Diagnose database, attachments, and Redis before removing the marker or starting services.`);
  return marker;
}

export async function restoreSnapshot() {
  const marker = await assertNoInterruptedRestore();
  if (!await access('.local/snapshot/manifest.json').then(() => true, () => false)) return false;
  const manifest = JSON.parse(await readFile('.local/snapshot/manifest.json', 'utf8'));
  if (manifest.format !== 1) throw new Error('Unsupported messaging snapshot format.');
  for (const file of ['database.dump', 'storage.tar', 'redis.tar']) {
    const hash = await sha256(`.local/snapshot/${file}`);
    if (hash !== manifest.files[file]) throw new Error(`Snapshot integrity check failed: ${file}. Existing state was not changed.`);
  }
  const table = await compose(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'chatwoot', '-At', '-c', "SELECT to_regclass('public.accounts') IS NOT NULL"], { capture: true });
  if (table === 't') { console.log('Existing messaging database retained; snapshot restore is unnecessary.'); return false; }
  if (table !== 'f') throw new Error('Cannot establish whether the messaging database is empty.');
  const tables = await compose(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'chatwoot', '-At', '-c', "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"], { capture: true });
  if (tables !== '0') throw new Error('Database has existing tables. Refusing to overwrite unrecognized state.');
  const redisKeys = await compose(['exec', '-T', 'redis', 'sh', '-c', 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli DBSIZE'], { capture: true });
  if (redisKeys !== '0') throw new Error('Redis has existing state. Refusing to overwrite it.');
  const storage = await compose(['run', '--rm', '--no-deps', '--entrypoint', 'sh', 'storage_tools', '-c', 'find /data -mindepth 1 -print -quit'], { capture: true, quiet: true });
  if (storage) throw new Error('Attachment storage has existing files. Refusing to overwrite them.');
  console.log('Restoring the verified messaging snapshot into empty Docker volumes.');
  await writeFile(marker, JSON.stringify({ started_at: new Date().toISOString(), project: process.env.OG_COMPOSE_PROJECT || 'omnigrow', snapshot: manifest.created_at }) + '\n', { mode: 0o600, flag: 'wx' });
  await compose(['stop', 'redis']);
  await compose(['exec', '-T', 'postgres', 'pg_restore', '-U', 'postgres', '-d', 'chatwoot', '--no-owner', '--exit-on-error'], { input: '.local/snapshot/database.dump' });
  // Empty Redis has created its own initial AOF. Replace it only after DBSIZE=0 was proved above.
  await compose(['run', '--rm', '--no-deps', '--entrypoint', 'sh', 'redis', '-c', 'rm -rf /data/appendonlydir /data/dump.rdb']);
  await compose(['run', '--rm', '-T', '--no-deps', '--entrypoint', 'tar', 'redis', '-xf', '-', '-C', '/data'], { input: '.local/snapshot/redis.tar' });
  await compose(['run', '--rm', '-T', '--no-deps', '--entrypoint', 'tar', 'storage_tools', '-xf', '-', '-C', '/data'], { input: '.local/snapshot/storage.tar' });
  await compose(['up', '-d', '--wait', '--wait-timeout', '120', 'redis']);
  await rm(marker);
  console.log('Messaging database, attachment storage, and queue restored.');
  return true;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.chdir(fileURLToPath(new URL('..', import.meta.url)));
  await restoreSnapshot();
}
