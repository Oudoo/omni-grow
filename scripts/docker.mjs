import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';

export function compactMode() {
  if (process.env.OG_PRODUCTION === '1' || process.env.OG_COMPACT === '0') return false;
  if (process.env.OG_COMPACT === '1') return true;
  try { return JSON.parse(readFileSync('.local/runtime.json', 'utf8')).compact === true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export const engineServices = () => compactMode() ? ['rails'] : ['rails', 'worker'];

export function composeArgs(args, project = process.env.OG_COMPOSE_PROJECT) {
  if (project && !/^[a-z][a-z0-9_-]{1,50}$/.test(project)) throw new Error('Invalid OG_COMPOSE_PROJECT name.');
  return ['compose', ...(project ? ['-p', project] : []), ...(process.env.OG_PRODUCTION === '1' ? ['--env-file', '.local/production.env', '-f', 'compose.yaml', '-f', 'compose.production.yaml'] : compactMode() ? ['-f', 'compose.yaml', '-f', 'compose.compact.yaml'] : []), ...args];
}
export async function docker(args, { input, output, capture = false, quiet = false } = {}) {
  const child = spawn('docker', args, { stdio: [input ? 'pipe' : 'ignore', output || capture ? 'pipe' : quiet ? 'ignore' : 'inherit', quiet ? 'pipe' : 'inherit'] });
  const pending = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`Docker operation ${args[0]} failed (${code}).`)));
  });
  let text = '';
  if (capture) child.stdout.on('data', chunk => { text += chunk; });
  if (quiet) child.stderr.resume();
  let outputDone;
  if (output) outputDone = pipeline(child.stdout, createWriteStream(output, { mode: 0o600, flags: 'wx' }));
  let inputDone;
  if (input) inputDone = pipeline(createReadStream(input), child.stdin);
  await Promise.all([pending, ...(outputDone ? [outputDone] : []), ...(inputDone ? [inputDone] : [])]);
  return text.trim();
}
export const compose = (args, options) => docker(composeArgs(args), options);
