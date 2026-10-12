import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
if (!process.stdout.isTTY) throw new Error('Initial credentials are displayed only in an interactive terminal. Read .local/bootstrap-credentials.json privately if needed.');
const credentials = JSON.parse(await readFile('.local/bootstrap-credentials.json', 'utf8'));
console.log('Initial local owner credentials (these may have been changed in administration):');
console.log(`Email: ${credentials.email}\nPassword: ${credentials.password}`);
console.log('Keep these private. Never commit this file or paste the password into chat.');
