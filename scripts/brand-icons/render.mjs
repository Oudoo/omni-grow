// Regenerates the PWA icon set for every brand from its SVG source.
// Usage: node scripts/brand-icons/render.mjs   (needs Playwright's Chromium)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../..', import.meta.url));
const brands = ['omnigrow', 'aboteeg'];
// Full-bleed variants shrink the glyph into the platform's safe zone.
const variants = [
  { file: 'icon-192.png', size: 192, fullBleed: false, scale: 1 },
  { file: 'icon-512.png', size: 512, fullBleed: false, scale: 1 },
  { file: 'maskable-512.png', size: 512, fullBleed: true, scale: 0.74 },
  { file: 'apple-touch-icon.png', size: 180, fullBleed: true, scale: 0.86 }
];
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || ['/usr/bin/chromium', '/opt/pw-browsers/chromium'].find(path => existsSync(path));
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const page = await browser.newPage({ deviceScaleFactor: 1 });
try {
  for (const id of brands) {
    const source = await readFile(`${root}scripts/brand-icons/${id}.svg`, 'utf8');
    const out = `${root}public/brands/${id}`;
    await mkdir(out, { recursive: true });
    await writeFile(`${out}/icon.svg`, source);
    for (const variant of variants) {
      let svg = source.replace('<svg ', `<svg width="${variant.size}" height="${variant.size}" `);
      if (variant.fullBleed) svg = svg.replace(/(<rect id="plate"[^>]*?) rx="\d+"/, '$1');
      if (variant.scale !== 1) svg = svg.replace('<g id="glyph">', `<g id="glyph" transform="translate(256 256) scale(${variant.scale}) translate(-256 -256)">`);
      await page.setViewportSize({ width: variant.size, height: variant.size });
      await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`);
      await page.locator('svg').screenshot({ path: `${out}/${variant.file}`, omitBackground: !variant.fullBleed });
    }
    console.log(`Rendered ${id} icons`);
  }
} finally { await browser.close(); }
