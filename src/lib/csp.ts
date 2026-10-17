// Content Security Policy for the workspace pages. Built per request with a nonce by src/proxy.ts.
// CSP_MODE=report-only (default) sends Content-Security-Policy-Report-Only and logs violations at
// /api/csp-report; CSP_MODE=enforce blocks; CSP_MODE=off disables the header.
export type CspMode = 'enforce' | 'report-only' | 'off';

export function cspMode(value: string | undefined = process.env.CSP_MODE): CspMode {
  return value === 'enforce' || value === 'off' ? value : 'report-only';
}

export function cspHeaderName(mode: CspMode) {
  return mode === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';
}

function originOf(value: string | undefined) {
  if (!value) return '';
  try { return new URL(value).origin; } catch { return ''; }
}

// Operator-supplied extra sources (for example an object storage host for attachments).
function extraSources(value: string | undefined) {
  return (value || '').split(/[\s,]+/).filter(source => /^(https?|wss?):\/\/[A-Za-z0-9.*:-]+$/.test(source));
}

export interface CspOptions {
  nonce: string;
  engineUrl?: string;
  appUrl?: string;
  development?: boolean;
  extraImageSources?: string;
  extraConnectSources?: string;
}

export function buildContentSecurityPolicy(options: CspOptions) {
  const engine = originOf(options.engineUrl);
  const https = originOf(options.appUrl).startsWith('https:');
  const join = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' ');
  return [
    "default-src 'self'",
    // 'strict-dynamic' trusts scripts loaded by nonced scripts: the Next.js runtime, the Meta SDK the
    // Channels page injects, and the website widget SDK on /demo. Host entries remain for older browsers.
    join("script-src 'self'", `'nonce-${options.nonce}'`, "'strict-dynamic'", options.development ? "'unsafe-eval'" : undefined, engine, 'https://connect.facebook.net'),
    // React inline style attributes (chart bar heights) need 'unsafe-inline' for styles only.
    "style-src 'self' 'unsafe-inline'",
    join("img-src 'self' data: blob:", engine, ...extraSources(options.extraImageSources)),
    join("connect-src 'self'", engine, 'https://graph.facebook.com https://www.facebook.com', ...extraSources(options.extraConnectSources)),
    join('frame-src', engine, 'https://www.facebook.com https://web.facebook.com https://staticxx.facebook.com'),
    join("media-src 'self' blob:", engine),
    "worker-src 'self' blob:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'report-uri /api/csp-report',
    ...(https ? ['upgrade-insecure-requests'] : [])
  ].join('; ');
}
