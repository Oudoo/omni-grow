'use client';
import { useState } from 'react';
import { stableAttempt, clearAttempt } from '@/lib/attempts';
import useSWR from 'swr';
import { Building2, Plus } from 'lucide-react';
import { request } from '@/lib/client';
import { fileSize, operatorApi } from '@/lib/business-client';
import type { Business, Invitation } from '@/lib/business-types';
import { Empty, ErrorNotice, Loading, Modal, PanelHeading } from './ui';
import { InvitationResult } from './business-settings';

const packageName = (plan: string) => plan === 'team' ? 'Team communications' : plan === 'business' ? 'Business' : 'Customer inbox';
export function BusinessOperator() {
  const { data, error, mutate, isLoading } = useSWR<{ businesses: Business[]; has_more: boolean }>('/api/operator/businesses', request);
  const [create, setCreate] = useState(false), [editing, setEditing] = useState<Business>(), [inviting, setInviting] = useState<Business>();
  const [older, setOlder] = useState<Business[]>([]), [busy, setBusy] = useState(false), [actionError, setActionError] = useState<Error>();
  const [notice, setNotice] = useState(''), [hasMore, setHasMore] = useState<boolean>();
  const [result, setResult] = useState<{ token: string; email: string }>();
  const all = [...(data?.businesses || []), ...older].filter((item, index, list) => list.findIndex(x => x.account_id === item.account_id) === index);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; setBusy(true); setActionError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const body = { ...Object.fromEntries(form), seat_limit: Number(form.get('seat_limit')), storage_limit_bytes: Math.round(Number(form.get('storage_gib')) * 1024 ** 3) };
      if (inviting) {
        const response = await operatorApi<{ invitation: Invitation; token: string }>(`businesses/${inviting.account_id}/invitations`, 'POST', Object.fromEntries(form));
        setResult({ token: response.token, email: response.invitation.email });
      } else if (editing) {
        await operatorApi(`businesses/${editing.account_id}`, 'PATCH', body);
      } else {
        const client_id = await stableAttempt('business-provision', JSON.stringify(body));
        const response = await operatorApi<{ invitation: Invitation | null; token: string | null }>('businesses', 'POST', { ...body, client_id });
        clearAttempt('business-provision');
        if (response.token && response.invitation) setResult({ token: response.token, email: response.invitation.email });
        else setNotice('This business was already created. Use Invite administrator to issue a new invitation link.');
      }
      setCreate(false); setEditing(undefined); setInviting(undefined); setOlder([]); setHasMore(undefined); await mutate();
    } catch (error) { setActionError(error as Error); } finally { setBusy(false); }
  }
  return <><PanelHeading eyebrow="OPERATOR CONSOLE" title="Businesses" description="Separate accounts, independent teams, packages you control." action={<button className="button primary" onClick={() => setCreate(true)}><Plus size={16} />Create business</button>} />{notice && <p role="status">{notice}</p>}<ErrorNotice error={error || actionError} retry={() => mutate()} />{isLoading ? <Loading /> : all.length ? <div className="operator-grid">{all.map(business => <article className="data-panel operator-card" key={business.account_id}><div className="section-title"><Building2 size={24} /><span className={`status-pill ${business.status === 'active' ? '' : 'muted'}`}>{business.status}</span></div><h2>{business.name}</h2><p>{packageName(business.plan)}</p><p className="muted">{business.used_seats} / {business.seat_limit} seats · {fileSize(business.storage_used_bytes)} used</p><div className="operator-actions"><button className="button secondary" onClick={() => setEditing(business)}>Manage package</button><button className="button subtle" onClick={() => setInviting(business)}>Invite administrator</button></div></article>)}</div> : <Empty title="Create your first business" text="Choose its package and invite its administrator. Employees and files stay inside that business." />}{(hasMore ?? data?.has_more) && <button className="button secondary" disabled={busy} onClick={async () => { setBusy(true); try { const next = await operatorApi<{ businesses: Business[]; has_more: boolean }>(`businesses?before=${all.at(-1)?.account_id}`); setOlder([...older, ...next.businesses]); setHasMore(next.has_more); } catch (error) { setActionError(error as Error); } finally { setBusy(false); } }}>Load more businesses</button>}
    {(create || editing || inviting) && <Modal title={inviting ? `Invite administrator · ${inviting.name}` : editing ? `Manage ${editing.name}` : 'Create a business'} close={() => { setCreate(false); setEditing(undefined); setInviting(undefined); }} busy={busy}><form className="form-stack" onSubmit={save}><ErrorNotice error={actionError} />{inviting ? <><label>Administrator name<input name="name" required maxLength={100} /></label><label>Administrator email<input name="email" type="email" required /></label></> : <>{!editing && <><label>Business name<input name="name" required maxLength={100} /></label><label>Administrator name<input name="owner_name" required maxLength={100} /></label><label>Administrator email<input name="owner_email" type="email" required maxLength={254} /></label></>}<label>Package<select name="plan" defaultValue={editing?.plan || 'business'}><option value="inbox">Customer inbox</option><option value="team">Team communications — standalone</option><option value="business">Business — inbox and team communications</option></select></label><div className="form-columns"><label>Employee seats<input name="seat_limit" type="number" min={1} max={10000} required defaultValue={editing?.seat_limit || 50} /></label><label>Document storage (GiB)<input name="storage_gib" type="number" min={0.01} max={10240} step={0.01} required defaultValue={editing ? editing.storage_limit_bytes / 1024 ** 3 : 10} /></label></div>{editing && <><label>Account status<select name="status" defaultValue={editing.status}><option value="active">Active</option><option value="suspended">Suspended</option></select></label><p className="small muted">Suspending access or removing team communications ends active team meetings. Stored messages and files are retained.</p></>}</>}<button className="button primary" disabled={busy}>{busy ? 'Saving…' : inviting ? 'Create administrator invitation' : editing ? 'Save package' : 'Create business and invitation'}</button></form></Modal>}{result && <InvitationResult {...result} close={() => setResult(undefined)} />}
  </>;
}
