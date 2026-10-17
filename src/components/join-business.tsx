'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { request } from '@/lib/client';
import { PASSWORD_POLICY_HINT, passwordPolicyProblem } from '@/lib/password-policy';
import { ErrorNotice, Loading } from './ui';
interface Preview { business_name: string; email: string; name: string; role: string; existing_user: boolean; signed_in_as_invitee: boolean; expires_at: string }
export function JoinBusiness() {
  const [token, setToken] = useState(''), [preview, setPreview] = useState<Preview>(), [error, setError] = useState<Error>(), [busy, setBusy] = useState(false), [accepted, setAccepted] = useState(false);
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token') || '';
    setToken(value);
    request<Preview>('/api/invitations/preview', { method: 'POST', body: JSON.stringify({ token: value }) }).then(setPreview).catch(setError);
  }, []);
  async function accept(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') || '');
    // The engine enforces this policy; explaining it here saves a rejected round trip.
    const problem = preview?.existing_user ? undefined : passwordPolicyProblem(password);
    if (problem) { setError(new Error(problem)); return; }
    setBusy(true); setError(undefined);
    try { await request('/api/invitations/accept', { method: 'POST', body: JSON.stringify({ token, password: password || undefined }) }); window.history.replaceState(null, '', '/join'); setToken(''); setAccepted(true); }
    catch (error) { setError(error as Error); } finally { setBusy(false); }
  }
  return <div className="join-page"><article className="data-panel join-card"><Link href="/login" className="brand"><span className="brand-mark">og↗</span><strong>OmniGrow</strong></Link>{accepted ? <><h1>You’re part of the team.</h1><p>Your access to {preview?.business_name} is ready. Sign in and select the business from your account menu.</p><Link className="button primary" href="/login">Continue to sign in</Link></> : <><h1>{preview ? `Join ${preview.business_name}` : 'Your business invitation'}</h1><ErrorNotice error={error} />{!preview && !error && <Loading />}{preview && <><p>You’ve been invited as {preview.role === 'administrator' ? 'an administrator' : 'an employee'} using <strong>{preview.email}</strong>.</p>{preview.existing_user && !preview.signed_in_as_invitee ? <><p>Sign in with this email first, then reopen this invitation. Your existing password stays the same.</p><Link className="button primary" href="/login" target="_blank">Sign in</Link><button className="button secondary" onClick={() => window.location.reload()}>I’ve signed in — check again</button></> : <form onSubmit={accept} className="form-stack">{!preview.existing_user && <label>Create your password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /><span className="small muted">{PASSWORD_POLICY_HINT}</span></label>}<button className="button primary" disabled={busy}>{busy ? 'Joining…' : 'Accept invitation'}</button></form>}</>}</>}</article></div>;
}
