import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

for (const [script, reuse, running] of [['migrate', false, true], ['setup', false, true], ['setup', true, true], ['setup', false, false]] as const) test(`${script} ${running ? reuse ? 'reuses a matching running engine image' : 'does not reuse an outdated running engine image' : 'reloads changed worker code when Rails was stopped'}`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'omnigrow-migrate-test-'));
  try {
    await mkdir(join(root, 'scripts')); await mkdir(join(root, 'bin')); await mkdir(join(root, '.local'));
    await mkdir(join(root, 'deploy/engine'), { recursive: true });
    await writeFile(join(root, 'deploy/engine/extension.rb'), '# Test extension version\n');
    for (const name of ['migrate.mjs', 'setup.mjs', 'meetings-config.mjs', 'provider-env.mjs', 'docker.mjs', 'restore-snapshot.mjs', 'files.mjs']) await copyFile(`scripts/${name}`, join(root, 'scripts', name));
    const trace = join(root, 'trace.jsonl');
    const docker = join(root, 'bin', 'docker');
    await writeFile(docker, `#!${process.execPath} --\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\nfs.appendFileSync(process.env.OG_TEST_TRACE, JSON.stringify(args) + '\\n');\nif (args.includes('config')) process.stdout.write(JSON.stringify({ services: { rails: { image: 'configured-image' } } }));\nif (args.includes('inspect')) process.stdout.write(args.includes('image') || process.env.OG_TEST_REUSE === '1' ? 'new-image-id' : 'old-image-id');\nif (args.includes('ps') && process.env.OG_TEST_RUNNING === '1') process.stdout.write('old-image-container\\n');\nif (args.includes('/app/omnigrow-bootstrap.rb')) process.stdout.write('OG_BOOTSTRAP_JSON:{\"owner_id\":1}\\n');\n`);
    await chmod(docker, 0o700);
    const health = join(root, 'health.mjs');
    await writeFile(health, 'globalThis.fetch = async () => new Response(null, { status: 200 });');
    const result = spawnSync(process.execPath, ['--import', health, join(root, 'scripts', `${script}.mjs`)], { encoding: 'utf8', env: { ...process.env, OG_PRODUCTION: '1', OG_COMPOSE_PROJECT: 'omnigrow-migrate-test', OG_TEST_TRACE: trace, OG_TEST_REUSE: reuse ? '1' : '0', OG_TEST_RUNNING: running ? '1' : '0', PATH: `${join(root, 'bin')}:${process.env.PATH}` } });
    assert.equal(result.status, 0, result.stderr);
    const calls: string[][] = (await readFile(trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const operations = calls.filter(args => args.includes('db:chatwoot_prepare') || args.includes('/app/omnigrow-bootstrap.rb') || (args.includes('/app/omnigrow/migrate.rb') && args.includes('runner')));
    assert.equal(operations.length, script === 'setup' ? 3 : 2);
    if (script === 'setup') assert(calls.some(args => args.includes('restart') && args.includes('rails') && args.includes('worker')), 'A changed extension must reload both services even when Rails was initially stopped.');
    for (const operation of operations) {
      assert.equal(operation.find(arg => arg === 'run' || arg === 'exec'), reuse ? 'exec' : 'run');
      if (reuse) continue;
      assert(operation.includes('--no-deps'), 'Migration/provisioning must not implicitly start another engine service');
      assert(operation.includes('--rm'), 'Temporary containers must be removed');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
