'use client';
import { useEffect, useRef, useState } from 'react';
import { clearConversationDrafts } from '@/lib/drafts';
interface RealtimeEvent { event: string; data: Record<string, unknown> }
export function useRealtime(onEvent: (event: RealtimeEvent) => void) {
  const [connected, setConnected] = useState(false);
  const callback = useRef(onEvent); callback.current = onEvent;
  useEffect(() => {
    const stream = new EventSource('/api/realtime');
    stream.addEventListener('ready', () => setConnected(true));
    stream.onmessage = event => {
      try { callback.current(JSON.parse(event.data)); } catch { setConnected(false); }
    };
    stream.onerror = () => setConnected(false);
    stream.addEventListener('session-ended', event => {
      stream.close(); setConnected(false);
      let reason = '';
      try { reason = JSON.parse((event as MessageEvent).data).reason; } catch {}
      // The initiating action reloads after its cookie response is committed.
      // Other tabs receive that completion through Workspace's BroadcastChannel.
      if (reason === 'revoked') { clearConversationDrafts(); window.location.assign('/login'); }
    });
    return () => { stream.close(); };
  }, []);
  return connected;
}
