'use client';
import { useEffect, useRef } from 'react';
import { LoaderCircle, X, Inbox } from 'lucide-react';
export function Loading({ label = 'Loading your workspace…' }: { label?: string }) { return <div className="loading"><LoaderCircle size={22} className="spin" /><span>{label}</span></div>; }
export function Empty({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Inbox size={30} /></span><h3>{title}</h3><p>{text}</p>{action}</div>;
}
export function ErrorNotice({ error, retry }: { error?: Error; retry?: () => void }) {
  if (!error) return null;
  return <div className="alert error" role="alert">{error.message}{retry && <button className="text-button" onClick={retry}>Retry</button>}</div>;
}
export function Modal({ title, children, close, busy = false }: { title: string; children: React.ReactNode; close: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close); closeRef.current = () => { if (!busy) close(); };
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    (ref.current?.querySelector<HTMLElement>('input:not([disabled]):not([type="hidden"]),textarea:not([disabled]),select:not([disabled])') || ref.current?.querySelector<HTMLElement>('button:not([disabled])'))?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'Tab') {
        const all = [...(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href]') || [])].filter(element => element.getClientRects().length > 0);
        const first = all[0], last = all.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', key); previouslyFocused?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) closeRef.current(); }}><div className="modal" ref={ref} role="dialog" aria-modal="true" aria-busy={busy} aria-label={title}><div className="modal-title"><h2>{title}</h2><button aria-label="Close dialog" className="icon-button" disabled={busy} onClick={() => closeRef.current()}><X size={20} /></button></div>{children}</div></div>;
}
export function PanelHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="panel-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}<span className="brand-dot">.</span></h1><p>{description}</p></div>{action}</div>;
}
