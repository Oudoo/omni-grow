'use client';
import { useRef, useState } from 'react';
import useSWR from 'swr';
import { CalendarClock } from 'lucide-react';
import type { Business, BusinessSubscription, SubscriptionChange } from '@/lib/business-types';
import { request } from '@/lib/client';
import { operatorApi } from '@/lib/business-client';
import { stableAttempt, clearAttempt } from '@/lib/attempts';
import { ErrorNotice, Loading, Modal } from './ui';

const currencies: Record<string, number> = { USD: 2, EUR: 2, GBP: 2, EGP: 2, AED: 2, SAR: 2, INR: 2, CAD: 2, AUD: 2, JPY: 0, KWD: 3, BHD: 3, OMR: 3 };
const date = (value: string | null) => value ? new Date(value).toLocaleString() : 'No expiry';
const termName = (term: BusinessSubscription) => term.interval === 'unlimited' ? 'Open-ended access' : term.interval === 'yearly' ? 'Yearly subscription' : 'Monthly subscription';
export function SubscriptionSummary({ subscription: term, compact = false }: { subscription: BusinessSubscription; compact?: boolean }) {
  const price = term.amount_minor !== undefined && term.currency ? new Intl.NumberFormat(undefined, { style: 'currency', currency: term.currency }).format(term.amount_minor / 10 ** (term.currency_exponent ?? 2)) : undefined;
  return <div className="subscription-summary"><div className="section-title"><strong><CalendarClock size={17} /> {termName(term)}</strong><span className={`status-pill ${['expired', 'cancelled', 'scheduled'].includes(term.status) ? 'muted' : ''}`}>{term.status === 'unlimited' ? 'Active' : term.status.replace(/^./, value => value.toUpperCase())}</span></div>{term.paid_through && <p className="small">Paid through {date(term.paid_through)}</p>}{!compact && <><dl className="business-usage"><dt>Access starts</dt><dd>{term.starts_at ? date(term.starts_at) : 'On activation'}</dd><dt>Grace period</dt><dd>{term.grace_days} days</dd><dt>Access until</dt><dd>{date(term.access_until)}</dd>{price && term.interval !== 'unlimited' && <><dt>Agreed price per {term.interval === 'yearly' ? 'year' : 'month'}</dt><dd>{price}</dd></>}</dl><p className="small muted">Payments are arranged with your service provider. Renewal is confirmed after payment; OmniGrow does not charge a card automatically.</p></>}</div>;
}
export function SubscriptionRequired({ business }: { business: Business }) {
  return <article className="data-panel subscription-required"><span className="eyebrow">BUSINESS SUBSCRIPTION</span><h1>{business.subscription.status === 'scheduled' ? 'Your access starts soon' : 'This business needs activation'}</h1><p>Contact your service provider to activate or renew {business.name}. Your stored messages and documents are retained.</p><SubscriptionSummary subscription={business.subscription} /></article>;
}
export function SubscriptionManager({ business, close, updated }: { business: Business; close: () => void; updated: () => void }) {
  const path = `/api/operator/businesses/${business.account_id}/subscription`;
  const { data, error, mutate, isLoading } = useSWR<{ business: Business; changes: SubscriptionChange[] }>(path, request, { revalidateOnFocus: false });
  const current = data?.business;
  const [operation, setOperation] = useState('activate'), [currency, setCurrency] = useState(business.subscription.currency || 'USD');
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState<Error>(), [notice, setNotice] = useState('');
  const pending = useRef<{ signature: string; body: Record<string, unknown> } | undefined>(undefined);
  const localStart = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !current) return; setBusy(true); setFailure(undefined); setNotice('');
    const form = event.currentTarget, fields = new FormData(form);
    try {
      const values: Record<string, unknown> = { operation, reference: String(fields.get('reference') || '').trim() };
      if (operation === 'activate') {
        const exponent = currencies[currency], entered = String(fields.get('price') || '');
        if (!new RegExp(`^\\d+(?:\\.\\d{1,${exponent || 1}})?$`).test(entered) || (exponent === 0 && entered.includes('.'))) throw new Error(`Enter a price with at most ${exponent} decimal places.`);
        const [whole, fraction = ''] = entered.split('.');
        const amount = Number(whole) * 10 ** exponent + Number(fraction.padEnd(exponent, '0'));
        if (!Number.isSafeInteger(amount) || amount > 1_000_000_000_000) throw new Error('This price is too large.');
        Object.assign(values, { interval: fields.get('interval'), starts_at: new Date(String(fields.get('starts_at'))).toISOString(), amount_minor: amount, currency, grace_days: Number(fields.get('grace_days')) });
      }
      const signature = JSON.stringify(values);
      if (pending.current?.signature !== signature) {
        const body = { ...values, version: current.subscription.version };
        pending.current = { signature, body: { ...body, client_id: await stableAttempt(`subscription-${business.account_id}`, JSON.stringify(body)) } };
      }
      const result = await operatorApi<{ business: Business; replayed: boolean }>(`businesses/${business.account_id}/subscription`, 'POST', pending.current.body);
      clearAttempt(`subscription-${business.account_id}`); pending.current = undefined;
      await mutate(); updated();
      (form.elements.namedItem('reference') as HTMLInputElement).value = '';
      setNotice(result.replayed ? 'The earlier action was already recorded. No extra period was added.' : 'Subscription updated.');
    } catch (error) { setFailure(error as Error); } finally { setBusy(false); }
  }
  return <Modal title={`Subscription · ${business.name}`} close={close} busy={busy}><ErrorNotice error={error || failure} retry={() => { pending.current = undefined; void mutate(); }} />{isLoading ? <Loading /> : current && <><SubscriptionSummary subscription={current.subscription} />{notice && <p role="status" className="success-text">{notice}</p>}<form className="form-stack" onSubmit={save}><fieldset disabled={busy}><label>Subscription action<select value={operation} onChange={event => { setOperation(event.target.value); setFailure(undefined); }}><option value="activate">Activate or replace a paid term</option>{current.subscription.interval !== 'unlimited' && <option value="renew">Record payment and renew one period</option>}<option value="unlimited">Grant open-ended access</option><option value="cancel">End access now</option></select></label>{operation === 'activate' && <><div className="form-columns"><label>Billing interval<select name="interval" defaultValue={current.subscription.interval === 'yearly' ? 'yearly' : 'monthly'}><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label><label>Access starts (your local time)<input name="starts_at" type="datetime-local" required defaultValue={localStart} /></label></div><div className="form-columns"><label>Agreed price per period<input name="price" type="number" min="0" max="1000000000000" step={10 ** -currencies[currency]} required defaultValue={(current.subscription.amount_minor || 0) / 10 ** (current.subscription.currency_exponent ?? 2)} /></label><label>Currency<select value={currency} onChange={event => setCurrency(event.target.value)}>{Object.keys(currencies).map(code => <option key={code}>{code}</option>)}</select></label></div><label>Grace period (days)<input name="grace_days" type="number" min="0" max="30" required defaultValue={current.subscription.grace_days} /></label><p className="small muted">This replaces the current term and price. A future start date restricts access until that date.</p></>}{operation === 'renew' && <p className="small muted">Adds one {current.subscription.interval === 'yearly' ? 'year' : 'month'} from the paid-through date while access is active or in grace. An expired or cancelled subscription starts a new period now. Record each payment once.</p>}{operation === 'cancel' && <p className="alert">This ends employee access and active meetings immediately. Stored data remains; no refund or card charge is processed.</p>}{operation === 'unlimited' && <p className="small muted">Access stays active until you end or replace it. Account suspension and package limits still apply.</p>}<label>{['activate', 'renew'].includes(operation) ? 'Unique payment or invoice reference' : 'Contract or adjustment reference'}<input name="reference" required maxLength={200} autoComplete="off" /></label><p className="small muted">Use a reference only. Do not enter card details, passwords or bank account credentials.</p></fieldset><button className="button primary" disabled={busy}>{busy ? 'Saving…' : operation === 'renew' ? 'Record renewal' : operation === 'cancel' ? 'End business access' : 'Save subscription'}</button></form><div className="subscription-history"><h3>Recent subscription changes</h3>{data?.changes.length ? data.changes.map(change => <article key={change.id}><strong>{change.action === 'activate' ? 'Term activated' : change.action === 'renew' ? 'Renewal recorded' : change.action === 'cancel' ? 'Access ended' : 'Open-ended access granted'}</strong><p className="small">{change.reference} · {date(change.created_at)}</p><p className="small muted">{termName(change.terms)} · Paid through {date(change.terms.paid_through)}</p></article>) : <p className="muted">No subscription changes recorded.</p>}</div></>}</Modal>;
}
