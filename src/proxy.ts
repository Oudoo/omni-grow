import { NextRequest, NextResponse } from 'next/server';
import { buildContentSecurityPolicy, cspHeaderName, cspMode } from '@/lib/csp';

// Runs on every request except static assets. Gives each request an id that is logged by the app,
// forwarded to the messaging engine and echoed to the browser, and attaches a nonce-based Content
// Security Policy to page responses. Caddy sets X-Request-ID in production; this fills it elsewhere.
const requestIdPattern = /^[A-Za-z0-9._-]{1,128}$/;

export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  let requestId = headers.get('x-request-id');
  if (!requestId || !requestIdPattern.test(requestId)) {
    requestId = crypto.randomUUID();
    headers.set('x-request-id', requestId);
  }
  const mode = cspMode();
  const page = !request.nextUrl.pathname.startsWith('/api/');
  let policy: string | undefined;
  if (page && mode !== 'off') {
    const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
    policy = buildContentSecurityPolicy({
      nonce,
      engineUrl: process.env.NEXT_PUBLIC_ENGINE_URL || 'http://localhost:3001',
      appUrl: process.env.APP_URL || 'http://localhost:3000',
      development: process.env.NODE_ENV === 'development',
      extraImageSources: process.env.CSP_IMAGE_SOURCES,
      extraConnectSources: process.env.CSP_CONNECT_SOURCES
    });
    headers.set('x-nonce', nonce);
    // Next.js reads the nonce from this request header and tags its own scripts, in both modes.
    headers.set('Content-Security-Policy', policy);
  }
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('X-Request-Id', requestId);
  if (policy) response.headers.set(cspHeaderName(mode), policy);
  return response;
}

export const config = {
  matcher: [{
    source: '/((?!_next/static|_next/image|favicon.ico).*)',
    missing: [{ type: 'header', key: 'next-router-prefetch' }, { type: 'header', key: 'purpose', value: 'prefetch' }]
  }]
};
