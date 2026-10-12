'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { BarChart3, ChevronDown, ChevronRight, CircleHelp, Command, Inbox as InboxIcon, LogOut, Network, Settings2, Sparkles, Users, Zap } from 'lucide-react';
import { clearConversationDrafts } from '@/lib/drafts';
import { request, initials } from '@/lib/client';
import type { Profile } from '@/lib/types';
import { InboxView } from './inbox';
import { Channels } from './channels';
import { Contacts } from './contacts';
import { Reports } from './reports';
import { AutomationView } from './automation';
import { SettingsView } from './settings';
import { ErrorNotice, Modal } from './ui';

const navigation = [
  { id: 'inbox', label: 'Shared inbox', icon: InboxIcon },
  { id: 'contacts', label: 'Contacts', icon: Users },
  { id: 'channels', label: 'Channels', icon: Network },
  { id: 'automation', label: 'Automations', icon: Zap },
  { id: 'reports', label: 'Reports', icon: BarChart3 }
];
export function Workspace({ section, initialProfile }: { section: string; initialProfile: Profile }) {
  const { data: profile = initialProfile, error } = useSWR<Profile>('/api/auth/me', request, { fallbackData: initialProfile, refreshInterval: 60000 });
  const [actionError, setActionError] = useState<Error>(), [accountMenu, setAccountMenu] = useState(false), [sessionBusy, setSessionBusy] = useState(false);
  const account = profile.accounts.find(a => a.id === profile.account_id)!;
  useEffect(() => { if (error?.status === 401 || error?.status === 403) { clearConversationDrafts(); window.location.assign('/login'); } }, [error]);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('omnigrow-session');
    channel.onmessage = event => { if (event.data === 'logout') clearConversationDrafts(); if (event.data === 'logout' || event.data === 'account-switch') window.location.assign(event.data === 'logout' ? '/login' : '/inbox'); };
    return () => channel.close();
  }, []);
  function announceSessionChange(change: string) { if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('omnigrow-session'); channel.postMessage(change); channel.close(); } }
  async function logout() { if (sessionBusy) return; setSessionBusy(true); try { await request('/api/auth/logout', { method: 'POST', body: '{}' }); clearConversationDrafts(); announceSessionChange('logout'); window.location.assign('/login'); } catch (e) { setActionError(e as Error); setSessionBusy(false); } }
  async function switchAccount(value: string) { if (sessionBusy) return; setSessionBusy(true); try { await request('/api/auth/account', { method: 'POST', body: JSON.stringify({ accountId: Number(value) }) }); announceSessionChange('account-switch'); window.location.assign('/inbox'); } catch (e) { setActionError(e as Error); setSessionBusy(false); } }
  return <div className="workspace-shell">
    <aside className="sidebar"><Link href="/inbox" className="brand"><span className="brand-mark">og<span>↗</span></span><strong>OmniGrow<span className="brand-dot">.</span></strong></Link>
      <div className="workspace-picker"><span className="workspace-avatar">{initials(account.name)}</span><div><span className="small muted">WORKSPACE</span>{profile.accounts.length > 1 ? <select aria-label="Workspace" disabled={sessionBusy} value={account.id} onChange={e => switchAccount(e.target.value)}>{profile.accounts.map(a => <option value={a.id} key={a.id}>{a.name}</option>)}</select> : <strong>{account.name}</strong>}</div><ChevronDown size={14} /></div>
      <div className="nav-label">YOUR WORKSPACE</div><nav>{navigation.map(({ id, label, icon: Icon }) => <Link href={`/${id}`} aria-label={label} key={id} className={`nav-item ${section === id ? 'active' : ''}`} aria-current={section === id ? 'page' : undefined}><Icon size={19} /><span>{label}</span>{section === id && <span className="nav-active-dot" />}</Link>)}</nav>
      <div className="sidebar-note"><span className="note-icon"><Sparkles size={18} /></span><strong>Connected feels better.</strong><p>Bring your next channel into the conversation.</p><Link href="/channels">Manage channels<ChevronRight size={15} /></Link></div>
      <div className="sidebar-bottom"><Link className={`nav-item ${section === 'settings' ? 'active' : ''}`} href="/settings" aria-label="Workspace settings"><Settings2 size={19} /><span>Workspace settings</span></Link><a className="nav-item" href="https://www.chatwoot.com/docs/product/" aria-label="Messaging guide" target="_blank" rel="noreferrer"><CircleHelp size={19} /><span>Messaging guide</span></a><div className="user-card"><span className="avatar small-avatar">{initials(profile.name)}</span><div><strong>{profile.name}</strong><span>{account.role === 'administrator' ? 'Workspace admin' : 'Support agent'}</span></div><button className="icon-button" onClick={logout} disabled={sessionBusy} aria-label="Sign out"><LogOut size={17} /></button></div></div>
    </aside>
    <main className="workspace-main"><header className="topbar"><div className="breadcrumb">Workspace<ChevronRight size={14} /><strong>{navigation.find(n => n.id === section)?.label || 'Settings'}</strong></div><div className="topbar-right"><span className="workspace-badge"><span />{account.name}</span><span className="topbar-symbol"><Command size={15} /> OG</span></div><button className="icon-button mobile-account-toggle" aria-label="Account menu" onClick={() => setAccountMenu(true)}><span className="avatar small-avatar">{initials(profile.name)}</span></button></header>
      {actionError && <ErrorNotice error={actionError} />}
      <div className={section === 'inbox' ? 'inbox-page' : 'standard-page'} key={profile.account_id}>
        {section === 'inbox' && <InboxView profile={profile} />}
        {section === 'channels' && <Channels profile={profile} />}
        {section === 'contacts' && <Contacts />}
        {section === 'reports' && <Reports />}
        {section === 'automation' && <AutomationView />}
        {section === 'settings' && <SettingsView profile={profile} />}
      </div>
    </main>
    {accountMenu && <Modal title="Your account" busy={sessionBusy} close={() => setAccountMenu(false)}><div className="form-stack"><strong>{profile.name}</strong><p className="muted">{profile.email}</p><label>Switch workspace<select aria-label="Switch workspace" disabled={sessionBusy} value={account.id} onChange={event => switchAccount(event.target.value)}>{profile.accounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="button secondary" disabled={sessionBusy} onClick={logout}><LogOut size={16} />Sign out of OmniGrow</button></div><ErrorNotice error={actionError} /></Modal>}
  </div>;
}
