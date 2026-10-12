'use client';
import { useCallback, useSyncExternalStore } from 'react';

interface Draft { text: string; files: File[]; missingFiles: string[]; sending: boolean }
type Change<T> = T | ((previous: T) => T);
const empty: Draft = { text: '', files: [], missingFiles: [], sending: false };
const prefix = 'omnigrow:draft:';
const drafts = new Map<string, Draft>();
const listeners = new Set<() => void>();
function read(key: string): Draft {
  if (drafts.has(key)) return drafts.get(key)!;
  let draft = empty;
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (saved && Date.now() - saved.updatedAt < 8 * 60 * 60 * 1000 && typeof saved.text === 'string') {
      draft = { text: saved.text, files: [], missingFiles: Array.isArray(saved.fileNames) ? saved.fileNames.filter((name: unknown) => typeof name === 'string') : [], sending: false };
    }
  } catch { /* Storage may be disabled. In-memory drafts still work. */ }
  drafts.set(key, draft);
  return draft;
}
function write(key: string, draft: Draft) {
  drafts.set(key, draft);
  try {
    if (!draft.text && !draft.files.length && !draft.missingFiles.length) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify({ text: draft.text, fileNames: [...draft.files.map(file => file.name), ...draft.missingFiles], updatedAt: Date.now() }));
  } catch { /* Keep the current draft in memory when storage is unavailable. */ }
  for (const notify of listeners) notify();
}
function update<T>(change: Change<T>, current: T) { return typeof change === 'function' ? (change as (value: T) => T)(current) : change; }
export function useConversationDraft(user: number, account: number, conversation: number, mode: 'reply' | 'note') {
  const key = `${prefix}${user}:${account}:${conversation}:${mode}`;
  const subscribe = useCallback((notify: () => void) => { listeners.add(notify); return () => { listeners.delete(notify); }; }, []);
  const snapshot = useCallback(() => read(key), [key]);
  const draft = useSyncExternalStore(subscribe, snapshot, () => empty);
  const setText = useCallback((value: Change<string>) => { const old = read(key); write(key, { ...old, text: update(value, old.text) }); }, [key]);
  const setFiles = useCallback((value: Change<File[]>) => {
    const old = read(key), files = update(value, old.files);
    const bytes = files.reduce((sum, file) => sum + file.size, 0);
    const otherBytes = [...drafts].filter(([id]) => id !== key).reduce((sum, [, item]) => sum + item.files.reduce((size, file) => size + file.size, 0), 0);
    if (bytes > 20 * 1024 * 1024) throw new Error('Attachments must be smaller than 20 MB in total.');
    if (bytes + otherBytes > 50 * 1024 * 1024) throw new Error('Send or remove attachments from another draft before adding more files.');
    write(key, { ...old, files, missingFiles: [] });
  }, [key]);
  const discardMissing = useCallback(() => write(key, { ...read(key), missingFiles: [] }), [key]);
  const beginSend = useCallback(() => {
    const current = read(key);
    if (current.sending) return false;
    write(key, { ...current, sending: true });
    return true;
  }, [key]);
  const endSend = useCallback(() => write(key, { ...read(key), sending: false }), [key]);
  return { ...draft, setText, setFiles, discardMissing, beginSend, endSend };
}
export function clearConversationDrafts() {
  drafts.clear();
  try { for (const key of Object.keys(sessionStorage)) if (key.startsWith(prefix)) sessionStorage.removeItem(key); } catch {}
  for (const notify of listeners) notify();
}
