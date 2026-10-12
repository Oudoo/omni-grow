import { fileURLToPath } from 'node:url';
import { compose } from './docker.mjs';
import { assertNoInterruptedRestore } from './restore-snapshot.mjs';

// Applies the engine's pending database migrations after pulling a new pinned image. The engine
// container does not migrate on boot. Take a snapshot first; see docs/DEPLOYMENT.md "Upgrade".
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
await assertNoInterruptedRestore();
await compose(['up', '-d', '--wait', '--wait-timeout', '120', 'postgres', 'redis']);
const running = (await compose(['ps', '--status', 'running', '-q', 'rails'], { capture: true })).trim();
const runner = running ? ['exec', '-T', 'rails'] : ['run', '--rm', '-T', 'rails'];
await compose([...runner, 'bundle', 'exec', 'rails', 'db:chatwoot_prepare']);
console.log('Database schema is current. Start or restart the messaging services to run the new release: npm run services:up.');
