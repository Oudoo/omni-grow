import { NextRequest, NextResponse } from 'next/server';
import { ApiError, checkOrigin, engineFetch, fail, jsonBody, loadProfile, requireSession } from '@/lib/server';
import { allowedWorkspaceRequest, redactSecrets } from '@/lib/policy';

type Context = { params: Promise<{ path: string[] }> };
async function handle(request: NextRequest, context: Context) {
  try {
    const state = await requireSession();
    const { path: parts } = await context.params;
    const path = parts.join('/');
    if (!allowedWorkspaceRequest(path, request.method)) throw new ApiError(404, 'This workspace action is unavailable.');
    const mutating = request.method !== 'GET';
    if (mutating) checkOrigin(request);
    if (mutating && /^(channels|inboxes|inbox_members|agents|automation_rules|webhooks|agent_bots|canned_responses)(\/|$)/.test(path)) {
      const profile = await loadProfile(state.auth);
      if (!profile.accounts.some(a => a.id === state.accountId && a.role === 'administrator')) throw new ApiError(403, 'Workspace administrator access is required.');
    }
    const version = path.startsWith('reports') ? 'v2' : 'v1';
    const query = request.nextUrl.search;
    let body: BodyInit | undefined;
    const headers = new Headers();
    if (mutating) {
      const contentType = request.headers.get('content-type') || '';
      const length = Number(request.headers.get('content-length') || 0);
      if (length > 20 * 1024 * 1024) throw new ApiError(413, 'Attachments must be smaller than 20 MB.');
      if (contentType.startsWith('multipart/form-data') && /^conversations\/[1-9]\d*\/messages$/.test(path)) {
        const form = await request.formData();
        let bytes = 0;
        for (const value of form.values()) if (value instanceof File) bytes += value.size;
        if (bytes > 20 * 1024 * 1024) throw new ApiError(413, 'Attachments must be smaller than 20 MB.');
        body = form;
      } else {
        if (!contentType.startsWith('application/json')) throw new ApiError(415, 'Send this action as JSON.');
        const text = await request.text();
        if (text.length > 100_000) throw new ApiError(413, 'This request is too large.');
        let parsed;
        try { parsed = JSON.parse(text); } catch { throw new ApiError(400, 'Invalid JSON.'); }
        if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') throw new ApiError(400, 'Expected an object.');
        body = JSON.stringify(parsed);
        headers.set('Content-Type', 'application/json');
      }
    }
    const response = await engineFetch(`/api/${version}/accounts/${state.accountId}/${path}${query}`, state.auth, { method: request.method, body, headers });
    const data = await jsonBody(response);
    if (!response.ok) {
      // Provider error bodies can contain tokens. Return only a safe, useful status.
      const messages: Record<number, string> = { 401: 'Your session expired. Please sign in again.', 403: 'Your role does not allow this action.', 404: 'This item is unavailable in your workspace.', 422: 'The service could not accept these details. Check the configuration and provider credentials.', 429: 'Too many requests. Please wait and retry.' };
      return NextResponse.json({ error: messages[response.status] || 'The messaging service could not complete this action. Please retry.' }, { status: response.status >= 500 ? 502 : response.status });
    }
    return NextResponse.json(redactSecrets(data), { status: response.status === 204 ? 200 : response.status });
  } catch (error) { return fail(error); }
}
export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
