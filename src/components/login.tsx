'use client';
import { useState } from 'react';
import { ArrowRight, Check, LoaderCircle, MessageCircle, ShieldCheck } from 'lucide-react';
import { request } from '@/lib/client';
export function Login() {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [mfa, setMfa] = useState(false), [backup, setBackup] = useState(false), [code, setCode] = useState('');
  async function signIn(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await request<{ mfaRequired?: boolean }>('/api/auth/login', { method: 'POST', body: JSON.stringify(mfa ? backup ? { backupCode: code } : { otpCode: code } : { email, password }) }); if (result.mfaRequired) { setMfa(true); setPassword(''); setBusy(false); return; } window.location.assign('/inbox'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not sign in.'); setBusy(false); }
  }
  return <main className="login-page">
    <section className="login-story"><a href="/" className="brand"><span className="brand-mark">og<span>↗</span></span><strong>OmniGrow<span className="brand-dot">.</span></strong></a>
      <div className="login-story-body"><span className="eyebrow light">A LITTLE CLOSER TO YOUR CUSTOMERS</span><h1>Every channel.<br />One conversation.</h1><p>Bring your team and your customers together.<br />Less switching. More human connection.</p>
        <div className="channel-orbit"><div className="orbit-center"><MessageCircle size={38} /></div>{['Website', 'WhatsApp', 'Instagram', 'Telegram', 'Messenger', 'Email'].map((name, i) => <span key={name} className={`orbit-pill orbit-${i}`}>{name}</span>)}</div>
      </div><div className="login-story-foot"><ShieldCheck size={18} /> Your workspace. Your data. Your relationships.</div>
    </section>
    <section className="login-form-side"><div className="login-form-wrap"><span className="eyebrow">WELCOME TO OMNIGROW</span><h2>Good conversations<br />start here.</h2><p className="muted">Sign in with your workspace account.</p>
      <form onSubmit={signIn}>{!mfa ? <><label>Email address<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label></> : <><p className="muted">{backup ? 'Enter an unused recovery code.' : 'Enter the current code from your authenticator app.'}</p><label>{backup ? 'Recovery code' : 'Verification code'}<input autoComplete="one-time-code" inputMode={backup ? 'text' : 'numeric'} required pattern={backup ? '[A-Fa-f0-9]{8}' : '[0-9]{6}'} value={code} onChange={e => setCode(e.target.value)} /></label><button type="button" className="text-button" onClick={() => { setBackup(!backup); setCode(''); }}>{backup ? 'Use authenticator app' : 'Use a recovery code'}</button><button type="button" className="text-button" onClick={() => { setMfa(false); setCode(''); setError(''); }}>Back to sign in</button></>}
        {error && <div className="alert error" role="alert">{error}</div>}
        <button className="button primary login-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <>{mfa ? 'Verify and sign in' : 'Sign in to your workspace'}<ArrowRight size={18} /></>}</button>
      </form><p className="login-help">Your administrator can create your account or help you regain access.</p><div className="login-proof"><span><Check size={15} /> One secure sign-in</span><span><Check size={15} /> All your channels</span></div>
    </div><footer>Built for the people behind your business.</footer></section>
  </main>;
}
