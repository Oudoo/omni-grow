'use client';
const memory = new Map<string, { digest: string; id: string }>();
const prefix = 'omnigrow:attempt:';
export async function contentDigest(value: string | Blob) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : await value.arrayBuffer();
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
// Retain uncertain sends across navigation/reload; persist hashes, never file
// bytes or business details. A confirmed success clears the attempt.
export async function stableAttempt(scope: string, fingerprint: string) {
  const key = prefix + scope, digest = await contentDigest(fingerprint);
  let previous = memory.get(key);
  if (!previous) { try { previous = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch {} }
  if (previous?.digest === digest && previous.id) return previous.id;
  const attempt = { digest, id: crypto.randomUUID() };
  memory.set(key, attempt);
  try { sessionStorage.setItem(key, JSON.stringify(attempt)); } catch {}
  return attempt.id;
}
export function clearAttempt(scope: string) {
  const key = prefix + scope; memory.delete(key);
  try { sessionStorage.removeItem(key); } catch {}
}
