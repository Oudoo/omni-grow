import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { ApiError, checkOrigin, engineFetch, jsonBody, readJsonBody, readLimitedBytes, type SessionData } from './server';

// Only use this function after a fixed-path allowlist and authentication check.
// Business errors come from our bounded, secret-free controller messages.
export async function businessProxy(request: NextRequest, upstream: string, auth?: SessionData['auth']) {
  let body: BodyInit | undefined;
  const headers = new Headers();
  if (request.method !== 'GET') {
    checkOrigin(request);
    const contentType = request.headers.get('content-type') || '';
    if (contentType.startsWith('multipart/form-data')) {
      const bytes = await readLimitedBytes(request, 21 * 1024 * 1024, 'Files must total no more than 20 MiB.');
      const form = await new Response(bytes, { headers: { 'content-type': contentType } }).formData();
      let total = 0;
      for (const value of form.values()) if (value instanceof File) total += value.size;
      if (total > 20 * 1024 * 1024) throw new ApiError(413, 'Files must total no more than 20 MiB.');
      body = form;
    } else {
      body = JSON.stringify(await readJsonBody(request));
      headers.set('Content-Type', 'application/json');
    }
  }
  const response = await engineFetch(upstream, auth, { method: request.method, body, headers }, request);
  const resultHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  if (response.ok && !response.headers.get('content-type')?.includes('application/json')) {
    return new Response(response.body, { status: response.status, headers: { ...resultHeaders,
      'Content-Type': response.headers.get('content-type') || 'application/octet-stream',
      'Content-Disposition': response.headers.get('content-disposition') || 'attachment',
      'Content-Security-Policy': "default-src 'none'; sandbox"
    } });
  }
  const data = await jsonBody(response);
  if (!response.ok) {
    const message = response.status >= 500 ? 'The business service could not complete this action. Retry when it is available.' :
      typeof data.error === 'string' && data.error.length < 500 ? data.error : 'This action is unavailable. Check your access and entered details.';
    return NextResponse.json({ error: message }, { status: response.status, headers: resultHeaders });
  }
  return NextResponse.json(data, { status: response.status, headers: resultHeaders });
}
