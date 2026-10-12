import { NextRequest, NextResponse } from 'next/server';
import { ApiError, checkOrigin, engineFetch, fail, jsonBody, loadProfile, requireSession } from '@/lib/server';
import { z } from 'zod';
import { redactSecrets } from '@/lib/policy';
export async function GET() {
  try { await requireSession(); return NextResponse.json({ facebookAppId: process.env.NEXT_PUBLIC_FB_APP_ID || null, apiVersion: process.env.NEXT_PUBLIC_FB_API_VERSION || 'v23.0', instagramConfigured: process.env.INSTAGRAM_APP_ID ? true : false }); } catch (error) { return fail(error); }
}
export async function POST(request: NextRequest) {
  try {
    checkOrigin(request);
    const state = await requireSession(), profile = await loadProfile(state.auth);
    if (!profile.accounts.some(a => a.id === state.accountId && a.role === 'administrator')) throw new ApiError(403, 'Workspace administrator access is required.');
    const parsed = z.discriminatedUnion('action', [
      z.object({ action: z.literal('instagram') }),
      z.object({ action: z.literal('facebook-pages'), token: z.string().min(1).max(4096) }),
      z.object({ action: z.literal('facebook-connect'), token: z.string().min(1).max(4096), pageId: z.string().regex(/^\d+$/), name: z.string().min(1).max(100) })
    ]).safeParse(await request.json());
    if (!parsed.success) throw new ApiError(400, 'Invalid channel connection request.');
    const input = parsed.data;
    if (input.action === 'instagram') {
      if (!process.env.INSTAGRAM_APP_ID) throw new ApiError(409, 'Configure the Instagram app ID and secret in the deployment settings first.');
      const response = await engineFetch(`/api/v1/accounts/${state.accountId}/instagram/authorization`, state.auth, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await jsonBody(response);
      if (!response.ok || !data.url || !['www.instagram.com', 'api.instagram.com'].includes(new URL(data.url).hostname)) throw new ApiError(422, 'Instagram could not start authorization. Check your app configuration.');
      return NextResponse.json({ url: data.url });
    }
    if (!process.env.NEXT_PUBLIC_FB_APP_ID) throw new ApiError(409, 'Configure your Meta app ID and secret in the deployment settings first.');
    const response = await engineFetch(`/api/v1/accounts/${state.accountId}/callbacks/facebook_pages`, state.auth, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ omniauth_token: input.token }) });
    const data = await jsonBody(response);
    if (!response.ok || !data.data?.page_details) throw new ApiError(422, 'Meta could not authorize your pages. Check your app permissions.');
    const pages = data.data.page_details as { id: string; name: string; access_token: string; exists: boolean }[];
    if (input.action === 'facebook-pages') return NextResponse.json({ pages: pages.map(({ id, name, exists }) => ({ id, name, exists })) });
    const page = pages.find(p => p.id === input.pageId && !p.exists);
    if (!page) throw new ApiError(403, 'This page is unavailable or already connected.');
    const created = await engineFetch(`/api/v1/accounts/${state.accountId}/callbacks/register_facebook_page`, state.auth, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_access_token: data.data.user_access_token, page_access_token: page.access_token, page_id: page.id, inbox_name: input.name }) });
    const result = await jsonBody(created);
    if (!created.ok || !result.id) throw new ApiError(422, 'The Facebook page could not be connected. Check the app subscription and permissions.');
    return NextResponse.json(redactSecrets(result));
  } catch (error) { return fail(error); }
}
