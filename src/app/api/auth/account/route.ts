import { endSessionStreams } from '@/lib/realtime-server';
import { NextRequest, NextResponse } from 'next/server';
import { ApiError, checkOrigin, fail, loadProfile, publicProfile, requireSession } from '@/lib/server';
export async function POST(request: NextRequest) {
  try {
    checkOrigin(request);
    const { accountId } = await request.json();
    const state = await requireSession();
    const profile = await loadProfile(state.auth);
    if (!Number.isSafeInteger(accountId) || !profile.accounts.some(a => a.id === accountId)) throw new ApiError(403, 'You do not have access to this workspace.');
    state.accountId = accountId;
    state.profile = { ...publicProfile(profile, accountId), pubsub_token: profile.pubsub_token };
    await state.save();
    endSessionStreams(state.auth, 'account-switch');
    return NextResponse.json(publicProfile(profile, accountId));
  } catch (error) { return fail(error); }
}
