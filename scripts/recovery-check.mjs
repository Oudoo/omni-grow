// Local-only acceptance check. Pauses messaging twice and removes only its own
// disposable Compose project, blob, and Redis key; never removes primary volumes.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { statfs } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compose, composeArgs, docker } from './docker.mjs';
import { assertNoInterruptedRestore, restoreSnapshot } from './restore-snapshot.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
if (process.env.OG_PRODUCTION === '1' || process.env.OG_COMPOSE_PROJECT) throw new Error('Recovery acceptance is for the default local installation only.');
await assertNoInterruptedRestore();
const disk = await statfs('.');
if (disk.bavail * disk.bsize < 1024 ** 3) throw new Error('At least 1 GiB free disk is needed for the isolated recovery check.');
const identity = randomUUID();
const project = `omnigrow-restorecheck-${identity.slice(0, 8)}`;
const filename = `omnigrow-recovery-${identity}.txt`;
const content = `OmniGrow attachment recovery verification ${identity}\n`;
const redisKey = `omnigrow:recovery:${identity}`;
const countsSQL = "SELECT json_build_object('accounts',(SELECT count(*) FROM accounts),'users',(SELECT count(*) FROM users),'inboxes',(SELECT count(*) FROM inboxes),'contacts',(SELECT count(*) FROM contacts),'conversations',(SELECT count(*) FROM conversations),'messages',(SELECT count(*) FROM messages),'blobs',(SELECT count(*) FROM active_storage_blobs))";
const isolated = (args, options) => docker(composeArgs(args, project), options);
const query = (run, sql) => run(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'chatwoot', '-At', '-c', sql], { capture: true });
async function snapshot() {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/snapshot.mjs'], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Snapshot failed (${code}).`)));
  });
}
let blob;
try {
  const output = await compose(['exec', '-T', 'rails', 'bundle', 'exec', 'rails', 'runner',
    "blob = ActiveStorage::Blob.create_and_upload!(io: StringIO.new(ARGV[1]), filename: ARGV[0], content_type: 'text/plain'); puts 'OG_RECOVERY_BLOB:' + { id: blob.id, key: blob.key, path: blob.service.send(:path_for, blob.key) }.to_json", filename, content], { capture: true });
  const result = output.split('\n').find(line => line.startsWith('OG_RECOVERY_BLOB:'));
  if (!result) throw new Error('Recovery fixture did not confirm its blob identity.');
  blob = JSON.parse(result.slice('OG_RECOVERY_BLOB:'.length));
  assert(Number.isSafeInteger(blob.id) && blob.id > 0 && /^[a-zA-Z0-9]+$/.test(blob.key) && blob.path.startsWith('/app/storage/') && !blob.path.includes('..'));
  await compose(['exec', '-T', 'redis', 'sh', '-c', 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli SET "$1" "$2"', '--', redisKey, identity], { capture: true });
  const expectedCounts = await query(compose, countsSQL);
  await snapshot();
  await isolated(['up', '-d', '--wait', '--wait-timeout', '120', 'postgres', 'redis']);
  process.env.OG_COMPOSE_PROJECT = project;
  try { assert.equal(await restoreSnapshot(), true); }
  finally { delete process.env.OG_COMPOSE_PROJECT; }
  assert.equal(await query(isolated, countsSQL), expectedCounts, 'Restored database record counts must match the source.');
  assert.equal(await query(isolated, `SELECT key FROM active_storage_blobs WHERE id=${blob.id}`), blob.key);
  const fileHash = await isolated(['run', '--rm', '--no-deps', '--entrypoint', 'sha256sum', 'storage_tools', blob.path.replace('/app/storage/', '/data/')], { capture: true, quiet: true });
  assert.equal(fileHash.split(/\s+/)[0], createHash('sha256').update(content).digest('hex'), 'Native attachment bytes must restore exactly.');
  const restoredKey = await isolated(['exec', '-T', 'redis', 'sh', '-c', 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli GET "$1"', '--', redisKey], { capture: true });
  assert.equal(restoredKey, identity, 'Redis state must restore.');
  process.env.OG_COMPOSE_PROJECT = project;
  try { assert.equal(await restoreSnapshot(), false, 'A repeat restore must retain an existing database.'); }
  finally { delete process.env.OG_COMPOSE_PROJECT; }
  console.log('PASS isolated recovery: database, native attachment bytes, Redis, and repeat-restore protection.');
} finally {
  delete process.env.OG_COMPOSE_PROJECT;
  await isolated(['down', '-v']); // Only the randomly named project created above.
  await compose(['exec', '-T', 'redis', 'sh', '-c', 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli DEL "$1"', '--', redisKey], { capture: true });
  if (blob) {
    await compose(['exec', '-T', 'rails', 'bundle', 'exec', 'rails', 'runner',
      "blob = ActiveStorage::Blob.find(ARGV[0]); raise 'Recovery fixture mismatch' unless blob.filename.to_s == ARGV[1]; blob.purge", String(blob.id), filename], { capture: true });
    await snapshot(); // Retain a clean reusable snapshot without the probe.
  }
}
