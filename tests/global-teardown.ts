import { readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
export default async function teardown() {
  const data = JSON.parse(await readFile('.local/test-fixture.json', 'utf8'));
  await new Promise<void>((resolve, reject) => {
    const child = spawn('docker', ['compose', 'exec', '-T', 'rails', 'bundle', 'exec', 'rails', 'runner', '/app/omnigrow-test-fixture.rb'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = ''; child.stdout.on('data', data => { out += data; }); child.stderr.on('data', data => { err += data; });
    child.stdin.end(JSON.stringify({ action: 'destroy', account_ids: [...data.accounts.map((a: { id: number }) => a.id), data.switch_account_id], user_ids: [...data.users.map((u: { id: number }) => u.id), data.agent.id, data.mfa.id] }));
    child.on('error', reject); child.on('exit', code => code === 0 && out.includes('OG_FIXTURE_CLEANED') ? resolve() : reject(new Error(`Test cleanup failed (${code}): ${err.slice(0, 200)}`)));
  });
  await rm('.local/test-fixture.json');
  await Promise.all([0, 1, 2].map(index => rm(`.local/test-session-${index}.json`, { force: true })));
}
