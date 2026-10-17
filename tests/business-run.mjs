import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
if (process.env.OG_PRODUCTION === '1' || process.env.OG_COMPOSE_PROJECT) throw new Error('Business acceptance is for the default local installation only.');
async function run(file, args, env = process.env, input) {
  await new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, stdio: [input ? 'pipe' : 'ignore', 'inherit', 'inherit'] });
    if (input) child.stdin.end(input);
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Acceptance command failed (${code}).`)));
  });
}
let fixture;
try {
  await run(process.execPath, ['tests/business-integration.mjs'], { ...process.env, OG_KEEP_BUSINESS_FIXTURE: '1' });
  fixture = JSON.parse(await readFile('.local/business-test-state.json', 'utf8'));
  await run(process.execPath, ['tests/business-browser.mjs']);
  await run(process.execPath, ['tests/business-onboarding.mjs']);
  await run(process.execPath, ['tests/business-lifecycle.mjs']);
  await run(process.execPath, ['tests/business-edge.mjs']);
} finally {
  if (fixture) {
    await run('docker', ['exec', '-i', 'omnigrow-rails-1', 'bundle', 'exec', 'rails', 'runner', '/app/omnigrow/test_fixture.rb'], process.env, JSON.stringify({ run: fixture.run, action: 'cleanup' }));
    await rm('.local/business-test-state.json', { force: true });
  }
}
