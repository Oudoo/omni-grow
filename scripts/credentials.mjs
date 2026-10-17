import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
if (!process.stdout.isTTY) throw new Error('Initial credentials are displayed only in an interactive terminal. Read .local/bootstrap-credentials.json privately if needed.');
let credentials;
try { credentials = JSON.parse(await readFile('.local/bootstrap-credentials.json', 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.log('The initial credentials file has been removed. Sign in with the password the owner set; an administrator can reset it in the messaging engine.');
  process.exit(1);
}
console.log('Initial local owner credentials (these may have been changed in administration):');
console.log(`Email: ${credentials.email}\nPassword: ${credentials.password}`);
console.log('Keep these private. Never commit this file or paste the password into chat. Delete it after changing the owner password.');
