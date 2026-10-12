'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import useSWR, { useSWRConfig } from 'swr';
import { ArrowLeft, ArrowUpRight, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, FileText, Inbox, LockKeyhole, MessageCircle, MoreHorizontal, Paperclip, Search, Send, Tag, UserRound, X, Zap } from 'lucide-react';
import { api, channelClass, channelName, ClientError, initials, timeLabel } from '@/lib/client';
import { safeExternalUrl } from '@/lib/policy';
import { useConversationDraft } from '@/lib/drafts';
import type { Agent, CannedResponse, Conversation, Inbox as ChannelInbox, Message, Profile } from '@/lib/types';
import { Empty, ErrorNotice, Loading, Modal } from './ui';
import { useRealtime } from './realtime';

interface ConversationResponse { data?: { payload: Conversation[]; meta?: Record<string, number> }; payload?: Conversation[]; meta?: Record<string, number> }
export function InboxView({ profile }: { profile: Profile }) {
  const [queue, setQueue] = useState('all'), [status, setStatus] = useState('open'), [channel, setChannel] = useState('all'), [search, setSearch] = useState(''), [query, setQuery] = useState(''), [selected, setSelected] = useState<number | null>(null), [page, setPage] = useState(1);
  const [typing, setTyping] = useState<{ id: number; name: string; until: number }[]>([]);
  const { data: inboxData } = useSWR<{ payload: ChannelInbox[] }>('inboxes', api);
  const inboxes = inboxData?.payload || [];
  const params = new URLSearchParams({ status: query ? 'all' : status, assignee_type: queue, page: String(page) });
  if (channel !== 'all') params.set('inbox_id', channel);
  if (query) params.set('q', query);
  const path = `conversations${query ? '/search' : ''}?${params}`;
  const { data, error, isLoading, mutate } = useSWR<ConversationResponse>(path, api, { refreshInterval: 15000 });
  const conversations = data?.data?.payload || data?.payload || [];
  const meta = data?.data?.meta || data?.meta;
  const [refreshTick, setRefreshTick] = useState(0);
  const connected = useRealtime(event => {
    if (event.event.startsWith('message.') || event.event.startsWith('conversation.')) { mutate(); setRefreshTick(t => t + 1); }
    if (event.event === 'conversation.typing_on' || event.event === 'conversation.typing_off') {
      const item = event.data as { conversation?: { id: number }; conversation_id?: number; user?: { id: number; name: string }; sender?: { id: number; name: string } };
      const user = item.user || item.sender, id = item.conversation?.id || item.conversation_id;
      if (id && user && user.id !== profile.id) setTyping(old => [...old.filter(t => t.id !== id || t.name !== user.name), ...(event.event.endsWith('_on') ? [{ id, name: user.name, until: Date.now() + 7000 }] : [])]);
    }
  });
  useEffect(() => { const timeout = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300); return () => clearTimeout(timeout); }, [search]);
  useEffect(() => { const interval = setInterval(() => setTyping(old => old.filter(t => t.until > Date.now())), 2000); return () => clearInterval(interval); }, []);
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get('conversation'));
    if (Number.isSafeInteger(id) && id > 0) setSelected(id);
  }, []);
  function filterQueue(value: string) { setQueue(value); setPage(1); }
  return <>
    <div className="inbox-heading"><div><span className="eyebrow">STAY CLOSE. GROW TOGETHER.</span><h1>Shared inbox<span className="brand-dot">.</span><span className="count-pill">{meta?.all_count ?? conversations.length}</span></h1></div><span className={`connection-pill ${connected ? 'connected' : ''}`}><span />{connected ? 'Live updates' : 'Checking for updates'}</span></div>
    <div className="inbox-toolbar"><div className="queue-tabs">{[['all', 'All conversations'], ['me', 'Assigned to me'], ['unassigned', 'Unassigned']].map(([value, label]) => <button key={value} className={queue === value ? 'active' : ''} onClick={() => filterQueue(value)}>{label}</button>)}</div><div className="inbox-filters"><select aria-label="Conversation status" value={query ? 'all' : status} disabled={!!query} title={query ? 'Search includes every conversation status.' : undefined} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="open">Open</option><option value="pending">Pending</option><option value="resolved">Resolved</option><option value="all">All statuses</option></select><select aria-label="Channel filter" value={channel} onChange={e => { setChannel(e.target.value); setPage(1); }}><option value="all">All channels</option>{inboxes.map(i => <option value={i.id} key={i.id}>{i.name}</option>)}</select></div></div>
    <div className={`inbox-grid ${selected ? 'has-selection' : ''}`}>
      <section className="conversation-queue" aria-label="Conversations"><div className="search-box"><Search size={17} /><input aria-label="Search conversations" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search conversations…" />{search && <button className="icon-button" aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}</div>
        <ErrorNotice error={error} retry={() => mutate()} />{isLoading ? <Loading /> : conversations.length === 0 ? <Empty title={query ? 'No matches yet' : 'A little breathing room'} text={query ? 'Try a different search or channel.' : 'Incoming customer messages will appear here. Connect a channel to get started.'} action={<Link className="text-button" href="/channels">Connect your channels<ArrowUpRight size={15} /></Link>} /> : <div className="conversation-items">{conversations.map(c => { const inbox = inboxes.find(i => i.id === c.inbox_id); return <button className={`conversation-item ${selected === c.id ? 'selected' : ''}`} key={c.id} onClick={() => setSelected(c.id)}><span className="avatar conversation-avatar">{initials(c.meta.sender.name)}<span className={`channel-dot ${channelClass(inbox)}`}><MessageCircle size={10} /></span></span><span className="conversation-item-body"><span className="conversation-item-top"><strong>{c.meta.sender.name || 'Website visitor'}</strong><time>{timeLabel(c.last_activity_at)}</time></span><span className="conversation-preview">{c.messages?.at(-1)?.content || 'New conversation'}</span><span className="conversation-item-foot"><span className={`channel-label ${channelClass(inbox)}`}>{channelName(inbox)}</span><span className="conversation-id">#{c.id}</span>{c.unread_count > 0 && <span className="unread-count">{c.unread_count}</span>}</span></span></button>; })}</div>}
        <div className="queue-footer"><span>Page {page}</span><div><button className="icon-button" disabled={page === 1} aria-label="Previous conversations" onClick={() => setPage(p => p - 1)}><ChevronLeft size={16} /></button><button className="icon-button" disabled={conversations.length < 20} aria-label="Next conversations" onClick={() => setPage(p => p + 1)}><ChevronRight size={16} /></button></div></div>
      </section>
      {selected ? <Thread key={selected} id={selected} inboxes={inboxes} profile={profile} refreshTick={refreshTick} typing={typing.filter(t => t.id === selected).map(t => t.name)} onChange={() => mutate()} back={() => setSelected(null)} /> : <div className="thread-empty"><div className="empty-orbit"><Inbox size={38} /></div><span className="eyebrow">EVERY CONVERSATION COUNTS</span><h2>Your customers, all together.</h2><p>Pick a conversation and make someone’s day.<br />One inbox keeps the whole story in view.</p><div className="thread-empty-channels">{['WhatsApp', 'Instagram', 'Messenger', 'Telegram', 'Website'].map(name => <span key={name}>{name}</span>)}</div></div>}
    </div>
  </>;
}

function Thread({ id, inboxes, profile, refreshTick, typing, onChange, back }: { id: number; inboxes: ChannelInbox[]; profile: Profile; refreshTick: number; typing: string[]; onChange: () => void; back: () => void }) {
  const { cache } = useSWRConfig();
  const fetchMessages = useCallback(async (path: string) => {
    // Use committed SWR data: it survives thread navigation and cannot advance
    // because of an overlapping request whose response SWR later discards.
    const retained = (cache.get(path)?.data as { payload: Message[] } | undefined)?.payload || [];
    const latest = await api<{ payload: Message[] }>(path);
    let cursor = Math.max(0, ...retained.map(message => message.id));
    const target = Math.max(0, ...latest.payload.map(message => message.id));
    const caughtUp: Message[] = [];
    // A reconnect or burst may outrun the latest-20 window. Walk forward from
    // the last successful fetch, without advancing its cursor on a failure.
    if (cursor && latest.payload.length && Math.min(...latest.payload.map(message => message.id)) > cursor) {
      while (cursor < target) {
        const page = await api<{ payload: Message[] }>(`${path}?after=${cursor}`);
        const next = Math.max(cursor, ...page.payload.map(message => message.id));
        if (next === cursor) throw new Error('Message history could not catch up. Retrying shortly.');
        caughtUp.push(...page.payload); cursor = next;
      }
    }
    return { payload: [...new Map([...retained, ...caughtUp, ...latest.payload].map(message => [message.id, message])).values()] };
  }, [cache]);
  const { data: conversation, error, mutate } = useSWR<Conversation>(`conversations/${id}`, api, { refreshInterval: 15000 });
  const { data: messageData, error: messageError, mutate: reloadMessages } = useSWR<{ payload: Message[] }>(`conversations/${id}/messages`, fetchMessages, { refreshInterval: 15000 });
  const { data: agentData } = useSWR<Agent[]>('agents', api);
  const { data: canned } = useSWR<CannedResponse[]>('canned_responses', api);
  const [note, setNote] = useState(false), [actionError, setActionError] = useState<Error>(), [older, setOlder] = useState<Message[]>([]), [loadingHistory, setLoadingHistory] = useState(false), [labelText, setLabelText] = useState(''), [busy, setBusy] = useState(false), [showDetails, setShowDetails] = useState(false), [historyFinished, setHistoryFinished] = useState(false), [newMessages, setNewMessages] = useState(false), [atBottom, setAtBottom] = useState(true);
  const replyDraft = useConversationDraft(profile.id, profile.account_id, id, 'reply');
  const noteDraft = useConversationDraft(profile.id, profile.account_id, id, 'note');
  const composer = note ? noteDraft : replyDraft;
  const { text: draft, setText: setDraft, files, setFiles, sending } = composer;
  const bottom = useRef<HTMLDivElement>(null), scroll = useRef<HTMLDivElement>(null), fileInput = useRef<HTMLInputElement>(null), lastTyping = useRef(0), newestSeen = useRef(0), markingSeen = useRef(false), previousLatest = useRef<number | undefined>(undefined), stickToBottom = useRef(true);
  const messages = [...new Map([...older, ...(messageData?.payload || [])].map(m => [m.id, m])).values()].sort((a, b) => a.id - b.id);
  const inbox = inboxes.find(i => i.id === conversation?.inbox_id);
  useEffect(() => { if (refreshTick) { mutate(); reloadMessages(); } }, [refreshTick, mutate, reloadMessages]);
  useEffect(() => {
    if (messageData?.payload) setOlder(old => [...new Map([...old, ...messageData.payload].map(message => [message.id, message])).values()]);
  }, [messageData]);
  const latestId = messages.at(-1)?.id;
  const latestIncoming = messages.filter(message => message.message_type === 0).at(-1)?.id || 0;
  useEffect(() => {
    if (!latestId || previousLatest.current === latestId) return;
    if (stickToBottom.current) bottom.current?.scrollIntoView({ block: 'nearest' });
    else if (previousLatest.current !== undefined) setNewMessages(true);
    previousLatest.current = latestId;
  }, [latestId]);
  useEffect(() => {
    const markSeen = () => {
      if (!atBottom || document.visibilityState !== 'visible' || !document.hasFocus() || markingSeen.current || newestSeen.current >= latestIncoming) return;
      markingSeen.current = true;
      api(`conversations/${id}/update_last_seen`, 'POST', {}).then(() => { newestSeen.current = latestIncoming; onChange(); }).catch(() => {}).finally(() => { markingSeen.current = false; });
    };
    markSeen(); document.addEventListener('visibilitychange', markSeen); window.addEventListener('focus', markSeen);
    return () => { document.removeEventListener('visibilitychange', markSeen); window.removeEventListener('focus', markSeen); };
  }, [id, latestIncoming, atBottom, onChange]);
  useEffect(() => () => { api(`conversations/${id}/toggle_typing_status`, 'POST', { typing_status: 'off' }).catch(() => {}); }, [id]);
  async function action(path: string, data: unknown) {
    setBusy(true); setActionError(undefined);
    try { await api(`conversations/${id}/${path}`, 'POST', data); await mutate(); onChange(); } catch (e) { setActionError(e as Error); } finally { setBusy(false); }
  }
  async function assign(value: string) {
    const assigneeId = value ? Number(value) : null;
    setBusy(true); setActionError(undefined);
    try {
      // Assignment is last-write-wins in the engine. Re-read before writing so two agents claiming
      // the same conversation at once do not silently overwrite each other.
      const fresh = await api<Conversation>(`conversations/${id}`);
      const currentId = fresh.meta.assignee?.id ?? null, shownId = conversation?.meta.assignee?.id ?? null;
      if (currentId !== shownId && currentId !== null && currentId !== assigneeId) {
        await mutate(fresh, { revalidate: false });
        throw new Error(`A teammate just assigned this conversation to ${fresh.meta.assignee?.name || 'someone else'}. Choose again to reassign it.`);
      }
      await api(`conversations/${id}/assignments`, 'POST', { assignee_id: assigneeId }); await mutate(); onChange();
    } catch (e) { setActionError(e as Error); } finally { setBusy(false); }
  }
  function updateDraft(value: string) {
    setDraft(value);
    if (Date.now() - lastTyping.current > 3500) { lastTyping.current = Date.now(); api(`conversations/${id}/toggle_typing_status`, 'POST', { typing_status: value ? 'on' : 'off', is_private: note }).catch(() => {}); }
  }
  // A gateway error or timeout can arrive after the engine already stored the message. Check the
  // thread before asking the agent to resend, so a retry does not deliver the same reply twice.
  async function alreadyDelivered(content: string) {
    try {
      const latest = await api<{ payload: Message[] }>(`conversations/${id}/messages`);
      const since = Date.now() / 1000 - 180;
      return latest.payload.some(message => message.message_type === 1 && !!message.private === note && message.sender?.id === profile.id && message.created_at >= since && (message.content || '') === content && (!files.length || (message.attachments?.length || 0) > 0));
    } catch { return false; }
  }
  async function send(event: React.FormEvent) {
    event.preventDefault(); if (sending || composer.missingFiles.length || (!draft.trim() && !files.length)) return;
    if (!composer.beginSend()) return;
    setActionError(undefined);
    const content = draft.trim();
    const finish = async () => {
      // Preserve a new draft or attachment selection made while this send was in flight.
      setDraft(current => current === draft ? '' : current);
      setFiles(current => current === files ? [] : current);
      stickToBottom.current = true; setAtBottom(true);
      await reloadMessages(); onChange();
      api(`conversations/${id}/toggle_typing_status`, 'POST', { typing_status: 'off' }).catch(() => {});
    };
    try {
      if (files.length) { const form = new FormData(); form.set('content', content); form.set('message_type', 'outgoing'); form.set('private', String(note)); for (const file of files) form.append('attachments[]', file); await api(`conversations/${id}/messages`, 'POST', form); }
      else await api(`conversations/${id}/messages`, 'POST', { content, message_type: 'outgoing', private: note });
      await finish();
    } catch (e) {
      const status = e instanceof ClientError ? e.status : -1;
      if ([0, 502, 503, 504].includes(status) && await alreadyDelivered(content)) { await finish(); setActionError(new Error('Your message was delivered even though the connection was interrupted.')); }
      else setActionError(e as Error);
    } finally { composer.endSend(); }
  }
  async function loadOlder() {
    if (!messages.length) return; setLoadingHistory(true);
    const previousHeight = scroll.current?.scrollHeight || 0, previousTop = scroll.current?.scrollTop || 0;
    stickToBottom.current = false; setAtBottom(false);
    try {
      const response = await api<{ payload: Message[] }>(`conversations/${id}/messages?before=${messages[0].id}`);
      setOlder(old => [...new Map([...response.payload, ...old].map(message => [message.id, message])).values()]);
      if (response.payload.length < 20) setHistoryFinished(true);
      requestAnimationFrame(() => { if (scroll.current) scroll.current.scrollTop = previousTop + scroll.current.scrollHeight - previousHeight; });
    } catch (e) { setActionError(e as Error); } finally { setLoadingHistory(false); }
  }
  const backButton = <button className="icon-button mobile-back" aria-label="Back to conversations" onClick={back}><ArrowLeft size={18} /></button>;
  if (error) return <div className="thread-pane"><header className="thread-header">{backButton}<strong>Conversation unavailable</strong></header><ErrorNotice error={error} retry={() => mutate()} /></div>;
  if (!conversation) return <div className="thread-pane"><header className="thread-header">{backButton}<strong>Opening conversation</strong></header><Loading /></div>;
  const contact = conversation.meta.sender;
  const templates = draft.startsWith('/') ? (canned || []).filter(c => c.short_code.startsWith(draft.slice(1))) : [];
  const details = <div className="conversation-details"><div className="contact-panel-heading"><h3>Customer details</h3><UserRound size={17} /></div><div className="contact-profile"><span className="avatar large-avatar">{initials(contact.name)}</span><h3>{contact.name}</h3><p>{contact.email || contact.phone_number || 'Website visitor'}</p></div><div className="detail-block"><label>Assigned to<select aria-label="Assigned agent" disabled={busy} value={conversation.meta.assignee?.id || ''} onChange={e => assign(e.target.value)}><option value="">Unassigned</option>{(agentData || []).map(a => <option value={a.id} key={a.id}>{a.name}{a.id === profile.id ? ' (you)' : ''}</option>)}</select></label><label>Priority<select aria-label="Conversation priority" disabled={busy} value={conversation.priority || 'none'} onChange={e => action('toggle_priority', { priority: e.target.value === 'none' ? null : e.target.value })}>{['none', 'low', 'medium', 'high', 'urgent'].map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}</select></label></div><div className="detail-block"><h4>CONTACT INFORMATION</h4><dl><dt>Email</dt><dd>{contact.email || 'Not provided'}</dd><dt>Phone</dt><dd>{contact.phone_number || 'Not provided'}</dd><dt>Conversation started</dt><dd>{new Date(conversation.created_at * 1000).toLocaleDateString()}</dd></dl></div><div className="detail-block"><h4><Tag size={13} /> CONVERSATION LABELS</h4><div className="label-chips">{conversation.labels?.map(label => <button key={label} className="label-chip" disabled={busy} onClick={() => action('labels', { labels: conversation.labels.filter(l => l !== label) })}>{label}<X size={11} /></button>)}</div><form className="inline-input" onSubmit={e => { e.preventDefault(); if (labelText.trim()) { action('labels', { labels: [...new Set([...(conversation.labels || []), labelText.trim()])] }); setLabelText(''); } }}><input aria-label="Add conversation label" value={labelText} onChange={e => setLabelText(e.target.value)} placeholder="Add a label…" /><button className="icon-button" disabled={busy || !labelText.trim()} aria-label="Save label"><Check size={14} /></button></form></div><div className="contact-panel-footer"><LockKeyhole size={13} /> Customer context stays with the conversation.</div></div>;
  return <>
    <section className="thread-pane" aria-label={`Conversation with ${contact.name}`}>
      <header className="thread-header">{backButton}<span className="avatar">{initials(contact.name)}</span><div className="thread-title"><strong>{contact.name}</strong><span><span className={`channel-label ${channelClass(inbox)}`}>{channelName(inbox)}</span><span className="muted">{inbox?.name} · #{id}</span></span></div><button className="icon-button details-toggle" aria-label="Conversation details" onClick={() => setShowDetails(true)}><UserRound size={18} /></button><button className={`button resolve-button ${conversation.status === 'resolved' ? 'secondary' : 'primary'}`} disabled={busy} onClick={() => action('toggle_status', { status: conversation.status === 'open' ? 'resolved' : 'open' })}><CircleCheck size={16} />{conversation.status === 'resolved' ? 'Reopen' : conversation.status === 'pending' || conversation.status === 'snoozed' ? 'Take over' : 'Resolve'}</button></header>
      <div className="thread-context"><span><LockKeyhole size={13} /> Only your workspace can see this conversation</span><span className="status-label">{conversation.status}</span></div>
      <ErrorNotice error={actionError || messageError} />
      <div className="message-scroll" ref={scroll} onScroll={event => { const element = event.currentTarget, near = element.scrollHeight - element.scrollTop - element.clientHeight < 80; stickToBottom.current = near; setAtBottom(near); if (near) setNewMessages(false); }}><div className="thread-date">{new Date(conversation.created_at * 1000).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })}</div>{messages.length >= 20 && !historyFinished && <button className="text-button history-button" disabled={loadingHistory} onClick={loadOlder}>{loadingHistory ? 'Loading…' : 'Load earlier messages'}</button>}
        {messages.map(message => <div key={message.id} className={`message-row ${message.message_type === 1 ? 'outgoing' : ''} ${message.private ? 'private-note' : ''} ${message.message_type === 2 ? 'activity-message' : ''}`}>
          {message.message_type !== 2 && message.message_type !== 1 && <span className="avatar message-avatar">{initials(message.sender?.name || contact.name)}</span>}
          <div className="message-wrap">{message.private && <span className="note-caption"><LockKeyhole size={12} /> Internal note · {message.sender?.name}</span>}<div className="message-bubble">{message.content && <p>{message.content}</p>}{message.attachments?.map(attachment => { const url = safeExternalUrl(attachment.data_url); return url ? <a className="attachment" href={url} target="_blank" rel="noreferrer" key={attachment.id}>{attachment.file_type === 'image' ? <img src={safeExternalUrl(attachment.thumb_url) || url} alt="Customer attachment" /> : <><FileText size={20} /><span>Attachment{attachment.extension ? `.${attachment.extension}` : ''}</span><ArrowUpRight size={14} /></>}</a> : null; })}</div>
            {message.message_type !== 2 && <span className={`message-time ${message.status === 'failed' ? 'failed' : ''}`}>
              {timeLabel(message.created_at)}
              {message.message_type === 1 && !message.private && (message.status === 'failed'
                ? <><span>Delivery failed</span><button className="text-button" disabled={busy} onClick={() => action(`messages/${message.id}/retry`, {})}>Retry</button></>
                : <><span>{message.status || 'Queued'}</span>{message.status === 'read' || message.status === 'delivered' ? <CheckCheck size={13} /> : <Check size={13} />}</>)}
            </span>}
          </div></div>)}
        {typing.length > 0 && <div className="typing-indicator">{typing.join(', ')} is typing…</div>}<div ref={bottom} />
      </div>
      {newMessages && <button className="new-messages button secondary" onClick={() => { stickToBottom.current = true; setAtBottom(true); setNewMessages(false); bottom.current?.scrollIntoView({ block: 'nearest' }); }}>New messages<ChevronDown size={15} /></button>}
      <form className={`composer ${note ? 'note-composer' : ''}`} onSubmit={send}><div className="composer-tabs"><button type="button" onClick={() => setNote(false)} className={!note ? 'active' : ''}><MessageCircle size={14} /> Reply</button><button type="button" onClick={() => setNote(true)} className={note ? 'active' : ''}><LockKeyhole size={14} /> Internal note</button><span>{note ? 'Visible to your team only' : `Sending via ${channelName(inbox)}`}</span></div>
        {templates.length > 0 && <div className="macro-menu">{templates.map(template => <button type="button" key={template.id} onClick={() => setDraft(template.content)}><Zap size={14} /><strong>/{template.short_code}</strong><span>{template.content}</span></button>)}</div>}
        <textarea aria-label={note ? 'Internal note' : 'Reply to customer'} maxLength={65000} value={draft} onChange={e => updateDraft(e.target.value)} placeholder={note ? 'Leave context for your teammates…' : 'Write a thoughtful reply…  / for saved replies'} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
        {!!composer.missingFiles.length && <div className="draft-warning" role="status"><span>Choose these files again after reloading: {composer.missingFiles.join(', ')}</span><button type="button" className="text-button" onClick={composer.discardMissing}>Remove missing attachments</button></div>}
        {files.length > 0 && <div className="composer-files">{files.map((file, index) => <span key={`${file.name}-${index}`}>{file.name}<button className="icon-button" type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles(old => old.filter((_, i) => i !== index))}><X size={12} /></button></span>)}</div>}
        <div className="composer-footer"><div><input ref={fileInput} type="file" multiple hidden onChange={e => { try { setFiles([...(e.target.files || [])]); setActionError(undefined); } catch (error) { setActionError(error as Error); } e.target.value = ''; }} /><button className="icon-button" type="button" aria-label="Attach files" onClick={() => fileInput.current?.click()}><Paperclip size={18} /></button><span className="shortcut-hint">⌘ / Ctrl ↵ to send</span></div><button className="button primary" disabled={sending || !!composer.missingFiles.length || (!draft.trim() && !files.length)}>{sending ? 'Sending…' : note ? 'Add note' : 'Send reply'}<Send size={15} /></button></div>
      </form>
    </section>
    {showDetails ? <Modal title="Conversation details" busy={busy} close={() => setShowDetails(false)}><ErrorNotice error={actionError} />{details}</Modal> : <aside className="contact-panel">{details}</aside>}
  </>;
}
