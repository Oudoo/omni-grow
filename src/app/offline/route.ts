import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brand } from '@/lib/brand';

// A self-contained page the service worker stores for use without a connection.
// It is rendered once at build time, so the icon is embedded rather than fetched.
export const dynamic = 'force-static';

const escape = (value: string) => value.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
function embeddedIcon() {
  try { return `data:image/svg+xml;base64,${readFileSync(join(process.cwd(), 'public', brand.iconDir, 'icon.svg')).toString('base64')}`; }
  catch { return undefined; }
}

export function GET() {
  const name = escape(brand.name), icon = embeddedIcon();
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="${brand.themeColor}"><title>Offline · ${name}</title>${icon ? `<link rel="icon" href="${icon}" type="image/svg+xml">` : ''}<style>
:root{color:#334d47;background:${brand.backgroundColor};font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
main{max-width:360px;text-align:center}img{width:72px;height:72px}h1{color:#203b36;font-size:24px;letter-spacing:-.5px;margin:22px 0 10px}
p{line-height:1.7;font-size:14px;color:#586d63;margin:0 0 24px}button{font:inherit;font-size:14px;font-weight:600;border:0;border-radius:8px;padding:12px 18px;background:#167b62;color:#fff;cursor:pointer}
</style></head><body><main>${icon ? `<img src="${icon}" alt="">` : ''}<h1>You're offline</h1><p>${name} needs an internet connection to load conversations. Check your Wi-Fi or mobile data, then try again.</p><button onclick="location.reload()">Try again</button></main></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate' } });
}
