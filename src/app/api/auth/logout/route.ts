import { endSessionStreams } from '@/lib/realtime-server';
import { NextRequest, NextResponse } from 'next/server';
import { checkOrigin, engineFetch, fail, session } from '@/lib/server';
export async function POST(request: NextRequest) {
  try {
    checkOrigin(request);
    const state = await session();
    if (state.auth) {
      const result = await engineFetch('/auth/sign_out', state.auth, { method: 'DELETE' });
      if (!result.ok && result.status !== 401 && result.status !== 404) return NextResponse.json({ error: 'Could not revoke your session. Please retry sign out.' }, { status: 503 });
    }
    if (state.auth) endSessionStreams(state.auth, 'logout');
    state.destroy();
    return NextResponse.json({ ok: true });
  } catch (error) { return fail(error); }
}
