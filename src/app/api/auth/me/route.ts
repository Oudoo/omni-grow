import { NextRequest, NextResponse } from 'next/server';
import { ApiError, fail, loadProfile, publicProfile, requireSession } from '@/lib/server';

export async function GET(request: NextRequest) {
  try {
    const state = await requireSession();
    const profile = await loadProfile(state.auth, request);
    if (!profile.accounts.some(a => a.id === state.accountId)) throw new ApiError(403, 'You no longer belong to this workspace.');
    return NextResponse.json(publicProfile(profile, state.accountId));
  } catch (error) { return fail(error, request); }
}
