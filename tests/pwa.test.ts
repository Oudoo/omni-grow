import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const publicDir = join(__dirname, '..', 'public');

test('the pharmacy build produces an installable, branded manifest', async () => {
  process.env.NEXT_PUBLIC_BRAND = 'aboteeg';
  const { default: manifest } = await import('../src/app/manifest');
  const result = manifest();
  assert.equal(result.name, 'Abo Teeg Pharmacy');
  assert.equal(result.short_name, 'Abo Teeg');
  assert.equal(result.display, 'standalone');
  assert.equal(result.start_url, '/');
  const icons = result.icons || [];
  for (const size of ['192x192', '512x512']) assert.ok(icons.some(icon => icon.sizes === size && icon.purpose === 'any'), size);
  assert.ok(icons.some(icon => icon.purpose === 'maskable'));
  for (const icon of icons) assert.ok(existsSync(join(publicDir, icon.src)), icon.src);
});

test('every brand ships the complete icon set', () => {
  const brands = readdirSync(join(publicDir, 'brands'));
  assert.deepEqual(brands.sort(), ['aboteeg', 'omnigrow']);
  for (const id of brands) for (const file of ['icon.svg', 'icon-192.png', 'icon-512.png', 'maskable-512.png', 'apple-touch-icon.png']) assert.ok(existsSync(join(publicDir, 'brands', id, file)), `${id}/${file}`);
});

test('the service worker never intercepts API calls or caches pages', async () => {
  const { readFile } = await import('node:fs/promises');
  const worker = await readFile(join(publicDir, 'sw.js'), 'utf8');
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)\) return;/);
  assert.match(worker, /request\.mode === 'navigate'[\s\S]*fetch\(request\)\.catch/);
});
