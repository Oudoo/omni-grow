import type { Inbox } from './types';
export class ClientError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { ...(init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
  const data = await response.json();
  if (!response.ok) throw new ClientError(data.error || 'This action could not be completed.', response.status);
  return data;
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
