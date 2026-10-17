import { request } from './client';
export const businessApi = <T = unknown>(path: string, method = 'GET', data?: unknown) => request<T>(`/api/business/${path}`, {
  method, ...(method !== 'GET' ? { body: data instanceof FormData ? data : JSON.stringify(data ?? {}) } : {})
});
export const operatorApi = <T = unknown>(path: string, method = 'GET', data?: unknown) => request<T>(`/api/operator/${path}`, {
  method, ...(method !== 'GET' ? { body: JSON.stringify(data ?? {}) } : {})
});
export function invitationLink(token: string) { return `${window.location.origin}/join#token=${encodeURIComponent(token)}`; }
export function fileSize(bytes: number) { return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GiB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : `${Math.ceil(bytes / 1024)} KiB`; }
