'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { Check, ExternalLink, Globe2, Plus, Trash2, Webhook as WebhookIcon } from 'lucide-react';
import { api, initials } from '@/lib/client';
import type { Agent, Profile, Webhook } from '@/lib/types';
import { Empty, ErrorNotice, Modal, PanelHeading } from './ui';
import { Employees } from './business-settings';
export function SettingsView({ profile }: { profile: Profile }) {
  const [tab, setTab] = useState('team'), [dialog, setDialog] = useState<string | null>(null), [error, setError] = useState<Error>(), [remove, setRemove] = useState<Webhook>(), [removing, setRemoving] = useState(false);
  const { data: agents, error: agentsError, mutate: reloadAgents } = useSWR<Agent[]>(tab === 'workspace' ? 'agents' : null, api);
  const { data: webhookData, error: hooksError, mutate: reloadHooks } = useSWR<{ payload: { webhooks: Webhook[] } }>(tab === 'webhooks' ? 'webhooks' : null, api);
  const hooks = webhookData?.payload?.webhooks || [];
  const account = profile.accounts.find(a => a.id === profile.account_id)!;
  async function deleteWebhook() { if (!remove || removing) return; setRemoving(true); setError(undefined); try { await api(`webhooks/${remove.id}`, 'DELETE', {}); setRemove(undefined); reloadHooks(); } catch (e) { setError(e as Error); } finally { setRemoving(false); } }
  return <><PanelHeading eyebrow="YOUR WORKSPACE, YOUR WAY" title="Make yourself at home" description="The people, permissions, and connections behind your customer experience." /><div className="page-tabs">{[['team', 'Your team'], ['webhooks', 'Webhooks'], ['workspace', 'Workspace']].map(([value, name]) => <button className={tab === value ? 'active' : ''} key={value} onClick={() => setTab(value)}>{name}</button>)}</div><ErrorNotice error={error || (tab === 'team' ? agentsError : tab === 'webhooks' ? hooksError : undefined)} />
    {tab === 'team' && <Employees administrator={account.role === 'administrator'} refresh={() => { void reloadAgents(); }} />}
    {tab === 'webhooks' && <><div className="data-toolbar"><p className="muted">Send conversation events to your CRM or other business tools.</p><button className="button primary" disabled={account.role !== 'administrator'} onClick={() => setDialog('webhooks')}><Plus size={15} />Add webhook</button></div>{!hooks.length ? <Empty title="Keep your tools in the loop" text="Dispatch conversation events to an HTTPS endpoint you control." /> : <div className="rule-list">{hooks.map(hook => <article className="rule-card" key={hook.id}><span className="rule-icon"><WebhookIcon size={22} /></span><div><strong>{hook.url}</strong><p>{hook.subscriptions.join(' · ')}</p></div><button className="icon-button" aria-label={`Delete webhook ${hook.id}`} disabled={account.role !== 'administrator'} onClick={() => setRemove(hook)}><Trash2 size={16} /></button></article>)}</div>}</>}
    {tab === 'workspace' && <div className="workspace-settings-grid"><article className="data-panel workspace-info"><span className="workspace-avatar large-avatar">{initials(account.name)}</span><h2>{account.name}</h2><p className="muted">Workspace #{account.id}</p><dl><dt>Your role</dt><dd>{account.role}</dd><dt>Your account</dt><dd>{profile.email}</dd><dt>Messaging engine</dt><dd>Chatwoot 4.18.0</dd></dl></article><article className="data-panel workspace-info"><Globe2 size={27} /><h2>Messaging administration</h2><p className="muted">Manage advanced routing, help centers, campaigns, bot assignment, and provider settings in the messaging engine. Use the same account credentials.</p><a className="button secondary" href={`${process.env.NEXT_PUBLIC_ENGINE_URL || 'http://localhost:3001'}/app/accounts/${account.id}/settings/general`} target="_blank" rel="noreferrer">Open administration<ExternalLink size={15} /></a><p className="small muted">Enterprise features may require a Chatwoot license. OmniGrow does not bypass those restrictions.</p></article></div>}
    {dialog && <SettingsForm type={dialog} close={() => setDialog(null)} done={() => { setDialog(null); reloadAgents(); reloadHooks(); }} />}
    {remove && <Modal title="Remove this webhook?" busy={removing} close={() => setRemove(undefined)}><ErrorNotice error={error} /><p>Conversation events will stop being sent to this endpoint.</p><div className="modal-actions"><button className="button secondary" disabled={removing} onClick={() => setRemove(undefined)}>Keep webhook</button><button className="button danger" disabled={removing} onClick={deleteWebhook}>{removing ? 'Removing…' : 'Remove'}</button></div></Modal>}
  </>;
}
function SettingsForm({ type, close, done }: { type: string; close: () => void; done: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<Error>();
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy) return; setBusy(true); setError(undefined); const form = new FormData(e.currentTarget);
    try { await api('webhooks', 'POST', { webhook: { url: form.get('url'), subscriptions: ['conversation_created', 'conversation_status_changed', 'message_created', 'message_updated', 'contact_created'] } }); done(); } catch (e) { setError(e as Error); } finally { setBusy(false); }
  }
  return <Modal title="Add a webhook" close={close} busy={busy}><ErrorNotice error={error} /><form className="form-stack" onSubmit={save}>{<><label>Event endpoint<input name="url" type="url" required pattern="https://.*" /></label><div className="info-box">This endpoint receives conversation, contact, and message lifecycle events. Verify the X-Chatwoot-Signature header using your webhook’s signing secret. Acknowledge promptly and monitor delivery failures.</div></>}<div className="modal-actions"><button className="button secondary" type="button" onClick={close} disabled={busy}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Add webhook'}<Check size={15} /></button></div></form></Modal>;
}
