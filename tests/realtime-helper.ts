import { expect, type APIRequestContext } from '@playwright/test';

export interface RealtimeFrame { event: string; data: Record<string, unknown> }
const opened = new Set<() => void>();
export async function openRealtime(client: APIRequestContext) {
  const { cookies } = await client.storageState();
  const controller = new AbortController();
  const response = await fetch('http://localhost:3000/api/realtime', {
    headers: { Cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ') }, signal: controller.signal
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const state = { frames: [] as RealtimeFrame[], closed: false, close: () => controller.abort() };
  opened.add(state.close);
  void (async () => {
    const reader = response.body!.getReader(), decoder = new TextDecoder();
    let buffered = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffered.indexOf('\n\n')) >= 0) {
          const frame = buffered.slice(0, boundary); buffered = buffered.slice(boundary + 2);
          const event = frame.split('\n').find(line => line.startsWith('event: '))?.slice(7);
          const data = frame.split('\n').find(line => line.startsWith('data: '))?.slice(6);
          if (event && data) state.frames.push({ event, data: JSON.parse(data) });
        }
      }
    } catch { /* Aborting the isolated test stream ends its reader. */ }
    finally { state.closed = true; opened.delete(state.close); }
  })();
  await expect.poll(() => state.frames.some(frame => frame.event === 'ready')).toBeTruthy();
  return state;
}
export function closeRealtimeStreams() { for (const close of opened) close(); opened.clear(); }
