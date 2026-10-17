import { fileURLToPath } from 'node:url';
import { compose } from './docker.mjs';
import { assertNoInterruptedRestore } from './restore-snapshot.mjs';

// Applies the engine's pending database migrations after pulling a new pinned image. The engine
// container does not migrate on boot. Take a snapshot first; see docs/DEPLOYMENT.md "Upgrade".
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
await assertNoInterruptedRestore();
await compose(['up', '-d', '--wait', '--wait-timeout', '120', 'postgres', 'redis']);
// A running container may still use the previous release even after docker compose pull.
// Always create the migration process from the image configured for this release.
await compose(['run', '--rm', '--no-deps', '-T', 'rails', 'bundle', 'exec', 'rails', 'db:chatwoot_prepare']);
await compose(['run', '--rm', '--no-deps', '-T', 'rails', 'bundle', 'exec', 'rails', 'runner', '/app/omnigrow/migrate.rb']);
console.log('Database schema is current. Start or restart the messaging services to run the new release: npm run services:up.');
