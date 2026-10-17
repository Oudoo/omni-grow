import type { Inbox } from './types';
export class ClientError extends Error { constructor(message: string, public status: number, public reference?: string) { super(message); } }
const unavailable = 'The messaging service is unavailable. Please retry; your draft is preserved.';
const fallbackMessages: Record<number, string> = {
  413: 'This request is too large. Attachments must be smaller than 20 MB in total.',
  429: 'Too many requests. Please wait a moment and retry.',
  502: unavailable, 503: unavailable, 504: unavailable
};
export async function request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers: { ...(init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
  } catch { throw new ClientError('You appear to be offline. Check your connection and retry; your draft is preserved.', 0); }
  // Proxies answer some failures (413, 502) with HTML pages rather than JSON.
  const json = (response.headers.get('content-type') || '').includes('application/json');
  const data = json ? await response.json().catch(() => undefined) : undefined;
  if (!response.ok) {
    const body = (data ?? {}) as { error?: unknown; reference?: unknown };
    throw new ClientError(typeof body.error === 'string' && body.error ? body.error : fallbackMessages[response.status] || 'This action could not be completed.', response.status, typeof body.reference === 'string' ? body.reference : undefined);
  }
  if (data === undefined) throw new ClientError('The workspace returned an unexpected response. Please retry.', response.status);
  return data as T;
}
export function api<T = unknown>(path: string, method = 'GET', data?: unknown) {
  return request<T>(`/api/workspace/${path}`, { method, ...(data !== undefined ? { body: data instanceof FormData ? data : JSON.stringify(data) } : {}) });
}
export function channelName(inbox?: Inbox) {
  const type = inbox?.channel_type?.replace('Channel::', '') || '';
  return ({ WebWidget: 'Website', Whatsapp: 'WhatsApp', FacebookPage: 'Messenger', Instagram: 'Instagram', Telegram: 'Telegram', Email: 'Email', Api: 'API', TwilioSms: 'SMS', Sms: 'SMS', Line: 'LINE' } as Record<string, string>)[type] || type || 'Channel';
}
export function channelClass(inbox?: Inbox) { return channelName(inbox).toLowerCase(); }
export function initials(name?: string) { return (name || '?').split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase(); }
export function timeLabel(timestamp?: number) {
  if (!timestamp) return '';
  const date = new Date(timestamp * 1000);
  return date.toDateString() === new Date().toDateString() ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
