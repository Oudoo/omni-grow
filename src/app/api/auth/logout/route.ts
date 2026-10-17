import { endSessionStreams } from '@/lib/realtime-server';
import { NextRequest, NextResponse } from 'next/server';
import { checkOrigin, clearSessionActivity, engineFetch, fail, log, requestReference, session } from '@/lib/server';

export async function POST(request: NextRequest) {
  try {
    checkOrigin(request);
    const state = await session();
    let revoked = true;
    if (state.auth) {
      // Revoke the engine token, but never leave a user unable to sign out because the engine is down:
      // the token only exists inside this sealed cookie, which is destroyed below either way.
      try {
        const result = await engineFetch('/auth/sign_out', state.auth, { method: 'DELETE' }, request);
        revoked = result.ok || result.status === 401 || result.status === 404;
      } catch { revoked = false; }
      if (!revoked) log('warn', 'engine session revocation failed; local session destroyed', { reference: requestReference(request) });
      endSessionStreams(state.auth, 'logout');
    }
    state.destroy();
    await clearSessionActivity();
    return NextResponse.json({ ok: true, revoked });
  } catch (error) { return fail(error, request); }
}
