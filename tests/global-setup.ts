import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
export default async function setup() {
  await Promise.all([0, 1, 2].map(index => rm(`.local/test-session-${index}.json`, { force: true })));
  const suffix = randomBytes(6).toString('hex');
  const credential = (role: string) => ({ email: `${role}-${suffix}@og-tests.local`, password: randomBytes(20).toString('base64url') + 'aA1!' });
  const input = { action: 'create', users: [credential('owner-a'), credential('owner-b')], agent: credential('agent'), mfa: credential('mfa') };
  await mkdir('.local', { recursive: true, mode: 0o700 });
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn('docker', ['compose', 'exec', '-T', 'rails', 'bundle', 'exec', 'rails', 'runner', '/app/omnigrow-test-fixture.rb'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', data => { out += data; }); child.stderr.on('data', data => { err += data; }); child.stdin.end(JSON.stringify(input));
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve(out) : reject(new Error(`Test fixture failed (${code}): ${err.slice(0, 200)}`)));
  });
  const line = output.split('\n').find(line => line.startsWith('OG_FIXTURE_JSON:'));
  if (!line) throw new Error('The test fixture did not return its record IDs.');
  await writeFile('.local/test-fixture.json', line.slice('OG_FIXTURE_JSON:'.length), { mode: 0o600 });
}
