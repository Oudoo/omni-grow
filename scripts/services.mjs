import { fileURLToPath } from 'node:url';
import { compose, engineServices } from './docker.mjs';
import { assertNoInterruptedRestore } from './restore-snapshot.mjs';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const action = process.argv[2];
if (action === 'up') {
  await assertNoInterruptedRestore();
  await compose(['up', '-d', '--wait', '--wait-timeout', '180', 'postgres', 'redis', ...engineServices()]);
}
else if (action === 'down') await compose(['down']);
else throw new Error('Use npm run services:up or npm run services:down.');
