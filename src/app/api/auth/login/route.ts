import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isIP } from 'node:net';
import { ApiError, checkOrigin, engineFetch, fail, jsonBody, publicProfile, session } from '@/lib/server';
import type { Profile } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    checkOrigin(request);
    const parsed = z.union([
      z.object({ email: z.email().max(254), password: z.string().min(1).max(256) }),
      z.object({ otpCode: z.string().regex(/^\d{6}$/) }),
      z.object({ backupCode: z.string().regex(/^[A-Fa-f0-9]{8}$/) })
    ]).safeParse(await request.json());
    if (!parsed.success) throw new ApiError(400, 'Enter valid sign-in details.');
    const state = await session();
    let credentials: Record<string, string>;
    if ('email' in parsed.data) credentials = parsed.data;
    else {
      if (!state.pendingMfa || state.pendingMfa.expiresAt < Date.now()) throw new ApiError(401, 'Verification expired. Start again with your email and password.');
      credentials = { mfa_token: state.pendingMfa.token, ...('otpCode' in parsed.data ? { otp_code: parsed.data.otpCode } : { backup_code: parsed.data.backupCode.toUpperCase() }) };
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
    // Enable only behind a trusted proxy that overwrites X-Real-IP.
    const clientIp = request.headers.get('x-real-ip');
    if (process.env.TRUST_PROXY === 'true' && clientIp && isIP(clientIp)) headers['X-Forwarded-For'] = clientIp;
    const response = await engineFetch('/auth/sign_in', undefined, { method: 'POST', headers, body: new URLSearchParams(credentials) });
    if (response.status === 429) return NextResponse.json({ error: 'Too many sign-in attempts. Please wait before trying again.' }, { status: 429, headers: { 'Retry-After': response.headers.get('retry-after') || '300' } });
    if (!response.ok) throw new ApiError(401, 'Unable to sign in. Check your credentials or verification code.');
    const data = await jsonBody(response);
    if (data.mfa_required && typeof data.mfa_token === 'string') {
      delete state.auth; delete state.profile; delete state.accountId; delete state.issuedAt;
      state.pendingMfa = { token: data.mfa_token, expiresAt: Date.now() + 5 * 60 * 1000 };
      await state.save();
      return NextResponse.json({ mfaRequired: true });
    }
    const token = response.headers.get('access-token'), client = response.headers.get('client'), uid = response.headers.get('uid');
    const profile = data.data as Profile;
    if (!token || !client || !uid || !profile?.accounts?.length) throw new ApiError(403, 'This account requires additional verification or has no active workspace.');
    const account = profile.accounts.find(a => a.id === profile.account_id) || profile.accounts[0];
    delete state.pendingMfa;
    state.auth = { 'access-token': token, client, uid };
    state.profile = { ...publicProfile(profile, account.id), pubsub_token: profile.pubsub_token };
    state.accountId = account.id;
    state.issuedAt = Date.now();
    await state.save();
    return NextResponse.json(publicProfile(profile, account.id));
  } catch (error) { return fail(error); }
}
