import { NextRequest } from 'next/server';
import { ApiError, engineFetch, engineUrl, fail, loadProfile, requireSession } from '@/lib/server';
import { redactSecrets } from '@/lib/policy';
import { sessionAbsoluteDeadline } from '@/lib/session-policy';
import { assertStreamCapacity, registerStream, type EndReason } from '@/lib/realtime-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const state = await requireSession();
    assertStreamCapacity(state.auth);
    const profile = await loadProfile(state.auth, request);
    if (!profile.accounts.some(account => account.id === state.accountId) || !profile.pubsub_token) throw new ApiError(403, 'Workspace access has been revoked.');
    const access = await engineFetch(`/api/v1/accounts/${state.accountId}/business/context`, state.auth, {}, request);
    if (!access.ok) throw new ApiError(access.status >= 500 ? 503 : 403, 'Workspace access is unavailable.');
    const identifier = JSON.stringify({ channel: 'RoomChannel', pubsub_token: profile.pubsub_token, user_id: profile.id, account_id: state.accountId });
    const encoder = new TextEncoder();
    let stop = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let ended = false, subscribed = false;
        let socket: WebSocket | undefined;
        let unregister = () => {};
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        let deadline: ReturnType<typeof setTimeout> | undefined;
        function emit(event: string, data: unknown) {
          if (ended) return;
          try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { stop(); }
        }
        stop = () => {
          if (ended) return;
          ended = true;
          clearInterval(heartbeat); clearTimeout(deadline);
          unregister(); request.signal.removeEventListener('abort', stop);
          try { socket?.close(); } catch {}
          try { controller.close(); } catch {}
        };
        const revoke = (reason: EndReason) => { emit('session-ended', { reason }); stop(); };
        // Membership and session expiry are re-checked every 20 seconds per sign-in by the registry,
        // which shares one engine request across all of this sign-in's tabs.
        try {
          unregister = registerStream(state.auth, { accountId: state.accountId, expiresAt: sessionAbsoluteDeadline(state), revoke, stop });
          request.signal.addEventListener('abort', stop, { once: true });
          if (request.signal.aborted) { stop(); return; }
          socket = new WebSocket(`${engineUrl().replace(/^http/, 'ws')}/cable`, ['actioncable-v1-json']);
          socket.addEventListener('open', () => { if (!ended) socket?.send(JSON.stringify({ command: 'subscribe', identifier })); });
          socket.addEventListener('message', message => {
            if (ended) return;
            try {
              const data = JSON.parse(String(message.data));
              if (data.type === 'confirm_subscription') { subscribed = true; clearTimeout(deadline); emit('ready', { connected: true }); }
              else if (data.type === 'reject_subscription' || data.type === 'disconnect') stop();
              // The native user token receives events from all of the user's
              // memberships. Only relay the workspace selected in this session.
              else if (data.message?.event && data.message.data?.account_id === state.accountId) emit('message', redactSecrets(data.message));
            } catch { stop(); }
          });
          socket.addEventListener('error', stop); socket.addEventListener('close', stop);
          deadline = setTimeout(stop, 10000);
          heartbeat = setInterval(() => {
            if (ended) return;
            emit('heartbeat', {});
            if (subscribed && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ command: 'message', identifier, data: JSON.stringify({ action: 'update_presence' }) }));
          }, 15000);
        } catch (error) { stop(); throw error; }
      },
      cancel() { stop(); }
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } });
  } catch (error) { return fail(error, request); }
}
