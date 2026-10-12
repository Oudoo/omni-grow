import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compose } from './docker.mjs';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
await mkdir('.local/backups', { recursive: true, mode: 0o700 });
const name = `.local/backups/chatwoot-${new Date().toISOString().replaceAll(':', '-')}.dump`;
await compose(['exec', '-T', 'postgres', 'pg_dump', '-U', 'postgres', '-Fc', 'chatwoot'], { output: name });
console.log(`Database backup saved: ${name}. Back up the storage volume and engine.env together with it.`);
