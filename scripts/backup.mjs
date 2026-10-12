import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compose } from './docker.mjs';
import { sha256 } from './files.mjs';

// Online backup: a consistent PostgreSQL dump plus an archive of attachment storage, with SHA-256
// checksums, local retention and an optional upload hook. No service is stopped. Attachments are
// immutable blobs, so the archive is complete for every message committed before the dump began;
// `npm run snapshot` remains the fully consistent (paused) alternative for migrations.
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const keep = Number(process.env.OG_BACKUP_KEEP || 14);
if (!Number.isInteger(keep) || keep < 1 || keep > 365) throw new Error('OG_BACKUP_KEEP must be a whole number of backups between 1 and 365.');
await mkdir('.local/backups', { recursive: true, mode: 0o700 });
const directory = `.local/backups/${new Date().toISOString().replaceAll(':', '-')}`;
await mkdir(directory, { mode: 0o700 });
console.log('Streaming an online database dump and an archive of attachment storage.');
await compose(['exec', '-T', 'postgres', 'pg_dump', '-U', 'postgres', '-Fc', 'chatwoot'], { output: `${directory}/database.dump` });
await compose(['run', '--rm', '-T', '--no-deps', '--entrypoint', 'tar', 'storage_tools', '-czf', '-', '-C', '/data', '.'], { output: `${directory}/storage.tar.gz`, quiet: true });
const files = {};
for (const name of ['database.dump', 'storage.tar.gz']) files[name] = await sha256(`${directory}/${name}`);
await writeFile(`${directory}/manifest.json`, JSON.stringify({ format: 1, kind: 'online-backup', created_at: new Date().toISOString(), files }, null, 2) + '\n', { mode: 0o600 });
// Retention: keep the newest backups, oldest first to go.
const backups = (await readdir('.local/backups', { withFileTypes: true })).filter(entry => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}T/.test(entry.name)).map(entry => entry.name).sort();
for (const old of backups.slice(0, Math.max(0, backups.length - keep))) await rm(`.local/backups/${old}`, { recursive: true, force: true });
// Off-host copy. Example: OG_BACKUP_UPLOAD='restic -r s3:s3.example.com/omnigrow backup "$1" .local/engine.env .local/engine.production.env .local/app.production.env .local/bootstrap-state.json'
if (process.env.OG_BACKUP_UPLOAD) {
  await new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', process.env.OG_BACKUP_UPLOAD, 'omnigrow-backup', directory], { stdio: 'inherit', env: { ...process.env, OG_BACKUP_DIR: directory } });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`Backup upload command exited ${code}. The local backup in ${directory} is complete.`)));
  });
}
console.log(`Backup saved in ${directory} (database.dump, storage.tar.gz, manifest.json). The dump contains provider credentials: keep it encrypted and store it with the encryption keys from .local/engine.env off this host.`);
