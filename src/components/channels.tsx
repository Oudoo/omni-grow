'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { ArrowRight, ArrowUpRight, Check, Code2, Copy, Globe2, Instagram, Mail, MessageCircle, Network, Plus, Send, Settings2, ShieldCheck } from 'lucide-react';
import { api, channelClass, channelName, request } from '@/lib/client';
import type { AgentBot, Inbox, Profile } from '@/lib/types';
import { Empty, ErrorNotice, Loading, Modal, PanelHeading } from './ui';

const catalog = [
  { id: 'web_widget', name: 'Website chat', description: 'Make your website a conversation. A live chat widget, ready to embed.', icon: Globe2, style: 'website', note: 'Ready to use' },
  { id: 'whatsapp', name: 'WhatsApp', description: 'Your business number, with shared replies and the full customer story.', icon: MessageCircle, style: 'whatsapp', note: 'Cloud API' },
  { id: 'instagram', name: 'Instagram', description: 'Keep DMs and story replies from your professional account in one place.', icon: Instagram, style: 'instagram', note: 'Business account' },
  { id: 'facebook', name: 'Facebook Messenger', description: 'Turn conversations with your Facebook Page into lasting relationships.', icon: MessageCircle, style: 'messenger', note: 'Meta app' },
  { id: 'telegram', name: 'Telegram', description: 'Connect your Telegram bot and let your whole team help customers.', icon: Send, style: 'telegram', note: 'Bot API' },
  { id: 'twilio_sms', name: 'SMS', description: 'Bring texts from your Twilio business number into the shared inbox.', icon: MessageCircle, style: 'sms', note: 'Twilio' },
  { id: 'line', name: 'LINE', description: 'Reply to customers messaging your LINE Official Account.', icon: MessageCircle, style: 'line', note: 'Messaging API' },
  { id: 'email', name: 'Email', description: 'A shared home for your support mailbox. Incoming mail and outgoing replies.', icon: Mail, style: 'email', note: 'IMAP + SMTP' },
  { id: 'api', name: 'Custom channel', description: 'Bring your chatbot or another service into the inbox through the API.', icon: Code2, style: 'api', note: 'API + webhooks' }
];
const engine = () => (process.env.NEXT_PUBLIC_ENGINE_URL || 'http://localhost:3001').replace(/\/$/, '');
export function Channels({ profile }: { profile: Profile }) {
  const { data, error, isLoading, mutate } = useSWR<{ payload: Inbox[] }>('inboxes', api);
  const [creating, setCreating] = useState<string | null>(null), [editing, setEditing] = useState<Inbox | null>(null), [snippet, setSnippet] = useState<Inbox | null>(null);
  const admin = profile.accounts.find(a => a.id === profile.account_id)?.role === 'administrator';
  return <><PanelHeading eyebrow="MEET YOUR CUSTOMERS WHERE THEY ARE" title="Your channels" description="Different places. One team. One inbox for every conversation." />
    <div className="channel-summary"><span className="summary-icon"><Network size={22} /></span><div><strong>{data?.payload.length ?? 0} configured {data?.payload.length === 1 ? 'channel' : 'channels'}</strong><p>Your team signs in once. Each channel connects with its provider credentials.</p></div><Link href="/inbox" className="text-button">Open shared inbox<ArrowRight size={16} /></Link></div>
    <ErrorNotice error={error} retry={() => mutate()} />
    {isLoading && <Loading />}
    {!!data?.payload.length && <section className="section-block"><div className="section-title"><h2>In your workspace</h2><span>{data.payload.length}</span></div><div className="connected-channel-list">{data.payload.map(inbox => <div className="connected-channel" key={inbox.id}><span className={`channel-icon ${channelClass(inbox)}`}><MessageCircle size={22} /></span><div><strong>{inbox.name}</strong><span>{channelName(inbox)}{inbox.phone_number ? ` · ${inbox.phone_number}` : inbox.email ? ` · ${inbox.email}` : ''}</span></div><span className={`configured-pill ${inbox.reauthorization_required ? 'warning' : ''}`}><span />{inbox.reauthorization_required ? 'Needs reconnection' : 'Configured'}</span>{inbox.website_token && <button className="button secondary" onClick={() => setSnippet(inbox)}><Code2 size={15} />Install widget</button>}<button className="icon-button" aria-label={`Settings for ${inbox.name}`} disabled={!admin} onClick={() => setEditing(inbox)}><Settings2 size={18} /></button></div>)}</div></section>}
    <section className="section-block"><div className="section-title"><h2>Make another connection</h2><span>CHANNEL LIBRARY</span></div><div className="channel-catalog">{catalog.map(channel => <article className="channel-card" key={channel.id}><div className="channel-card-top"><span className={`channel-icon ${channel.style}`}><channel.icon size={25} /></span><span className="channel-card-note">{channel.note}</span></div><h3>{channel.name}</h3><p>{channel.description}</p><button className="text-button" disabled={!admin} onClick={() => setCreating(channel.id)}>Connect {channel.id === 'web_widget' ? 'website' : channel.name}<Plus size={16} /></button></article>)}</div></section>
    <div className="channel-footnote"><ShieldCheck size={18} /><p>Provider credentials stay on the messaging server. Account owners authorize each connection.</p></div>
    {creating && <ConnectChannel type={creating} profile={profile} close={() => setCreating(null)} done={() => { setCreating(null); mutate(); }} />}
    {editing && <InboxSettings inbox={editing} close={() => setEditing(null)} done={() => { setEditing(null); mutate(); }} />}
    {snippet && <WidgetSnippet inbox={snippet} close={() => setSnippet(null)} />}
  </>;
}
function ConnectChannel({ type, profile, close, done }: { type: string; profile: Profile; close: () => void; done: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<Error>();
  const { data: meta } = useSWR<{ facebookAppId: string | null; instagramConfigured: boolean; apiVersion: string }>('/api/channels/meta', request);
  const [createdInbox, setCreatedInbox] = useState<Inbox>();
  const [facebook, setFacebook] = useState<{ token: string; pages: { id: string; name: string; exists: boolean }[] }>();
  const title = catalog.find(c => c.id === type)?.name || 'Channel';
  useEffect(() => {
    if (type !== 'facebook' || !meta?.facebookAppId || document.getElementById('og-facebook-sdk')) return;
    const script = document.createElement('script'); script.id = 'og-facebook-sdk'; script.src = 'https://connect.facebook.net/en_US/sdk.js'; script.crossOrigin = 'anonymous'; script.onload = () => window.FB?.init({ appId: meta.facebookAppId!, version: meta.apiVersion, cookie: false, xfbml: false });
    script.onerror = () => setError(new Error('The Meta sign-in script could not load. Check network access and retry.'));
    document.body.appendChild(script);
  }, [type, meta]);
  async function connectFacebook() {
    if (!window.FB) { setError(new Error('Meta sign-in is still loading. Please retry shortly.')); return; }
    setBusy(true); setError(undefined);
    window.FB.login(async response => {
      const token = response.authResponse?.accessToken;
      if (!token) { setBusy(false); setError(new Error('Meta authorization was canceled. You can try again.')); return; }
      try { const data = await request<{ pages: { id: string; name: string; exists: boolean }[] }>('/api/channels/meta', { method: 'POST', body: JSON.stringify({ action: 'facebook-pages', token }) }); setFacebook({ token, pages: data.pages }); }
      catch (e) { setError(e as Error); } finally { setBusy(false); }
    }, { scope: 'pages_messaging,pages_show_list,pages_manage_metadata,pages_read_engagement,business_management' });
  }
  async function finishConnection(inbox: Inbox) {
    setCreatedInbox(inbox);
    try { await api('inbox_members', 'POST', { inbox_id: inbox.id, user_ids: [profile.id] }); }
    catch { setError(new Error('The channel was created. Open its settings to assign agents before using it.')); return; }
    done();
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; setBusy(true); setError(undefined);
    const form = new FormData(event.currentTarget), value = (name: string) => String(form.get(name) || '').trim();
    try {
      if (type === 'instagram') { const data = await request<{ url: string }>('/api/channels/meta', { method: 'POST', body: JSON.stringify({ action: 'instagram' }) }); window.location.assign(data.url); return; }
      if (type === 'facebook') { if (!facebook) return; const inbox = await request<Inbox>('/api/channels/meta', { method: 'POST', body: JSON.stringify({ action: 'facebook-connect', token: facebook.token, pageId: value('page'), name: value('name') }) }); await finishConnection(inbox); return; }
      if (type === 'twilio_sms') { const inbox = await api<Inbox>('channels/twilio_channel', 'POST', { twilio_channel: { name: value('name'), medium: 'sms', phone_number: value('phone_number'), account_sid: value('account_sid'), auth_token: value('auth_token') } }); await finishConnection(inbox); return; }
      const channel: Record<string, unknown> = { type };
      if (type === 'line') Object.assign(channel, { line_channel_id: value('line_channel_id'), line_channel_secret: value('line_channel_secret'), line_channel_token: value('line_channel_token') });
      if (type === 'web_widget') Object.assign(channel, { website_url: value('website_url'), widget_color: '#167d63', welcome_title: 'Let’s talk.', welcome_tagline: 'How can we help you today?' });
      if (type === 'telegram') channel.bot_token = value('bot_token');
      if (type === 'whatsapp') Object.assign(channel, { phone_number: value('phone_number'), provider: 'whatsapp_cloud', provider_config: { api_key: value('api_key'), phone_number_id: value('phone_number_id'), business_account_id: value('business_account_id') } });
      if (type === 'email') Object.assign(channel, { email: value('email'), imap_enabled: true, imap_address: value('imap_address'), imap_port: 993, imap_enable_ssl: true, imap_login: value('email'), imap_password: value('password'), smtp_enabled: true, smtp_address: value('smtp_address'), smtp_port: 587, smtp_domain: value('smtp_address'), smtp_login: value('email'), smtp_password: value('password'), smtp_authentication: 'login', smtp_enable_starttls_auto: true, smtp_enable_ssl_tls: false, smtp_openssl_verify_mode: 'peer' });
      if (type === 'api') channel.webhook_url = value('webhook_url');
      const inbox = await api<Inbox>('inboxes', 'POST', { name: value('name'), channel, enable_auto_assignment: true });
      await finishConnection(inbox);
    } catch (e) { setError(e as Error); } finally { setBusy(false); }
  }
  const publicUrlRequired = type === 'twilio_sms' && !engine().startsWith('https://');
  const missingMeta = type === 'facebook' && !meta?.facebookAppId || type === 'instagram' && !meta?.instagramConfigured;
  return <Modal title={`Connect ${title}`} close={close} busy={busy}><p className="muted modal-description">Messages from this channel will appear in your shared inbox.</p><ErrorNotice error={error} /><form onSubmit={submit} className="form-stack">
    {['facebook', 'instagram'].includes(type) ? <><div className="info-box"><strong>Authorize your business account</strong><p>{missingMeta ? 'Your deployment needs a Meta developer app, approved messaging permissions, and a public HTTPS callback. Your administrator can configure these using the deployment guide.' : 'You will be redirected to the provider to authorize access. OmniGrow never asks for your social account password.'}</p></div>{type === 'facebook' && !facebook && <button type="button" className="button primary" onClick={connectFacebook} disabled={busy || missingMeta}>Continue with Facebook<ArrowUpRight size={16} /></button>}{facebook && <><label>Facebook Page<select name="page" required>{facebook.pages.filter(p => !p.exists).map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label>{!facebook.pages.some(p => !p.exists) && <p className="muted">No unconnected pages were returned. Check your business permissions.</p>}<label>Inbox name<input name="name" required maxLength={100} /></label></>}</> : <><label>Inbox name<input name="name" required maxLength={100} autoComplete="off" /></label>
      {type === 'web_widget' && <label>Your website URL<input name="website_url" type="url" required placeholder="https://your-business.com" /></label>}
      {type === 'telegram' && <><label>Bot token<input name="bot_token" type="password" required autoComplete="off" /></label><div className="info-box">Create a bot with Telegram’s @BotFather. Connecting registers its webhook to your public messaging domain. A local HTTP address cannot receive Telegram messages.</div></>}
      {type === 'whatsapp' && <><label>Business phone number<input name="phone_number" type="tel" required pattern="\+[1-9][0-9]{6,14}" placeholder="+201234567890" /></label><div className="form-columns"><label>Phone number ID<input name="phone_number_id" required pattern="[0-9]+" /></label><label>Business account ID<input name="business_account_id" required pattern="[0-9]+" /></label></div><label>Permanent access token<input name="api_key" type="password" autoComplete="off" required /></label><div className="info-box">Use your WhatsApp Business Cloud API credentials. After connecting, subscribe the Meta app to the WhatsApp webhook on your public messaging domain. Meta’s messaging window and template rules apply.</div></>}
      {type === 'twilio_sms' && <><label>Twilio phone number<input name="phone_number" type="tel" required pattern="\+[1-9][0-9]{6,14}" placeholder="+201234567890" /></label><label>Twilio account SID<input name="account_sid" required pattern="AC[a-fA-F0-9]{32}" autoComplete="off" /></label><label>Twilio auth token<input name="auth_token" type="password" required autoComplete="off" /></label><div className="info-box">{publicUrlRequired ? 'Configure your public HTTPS messaging domain before connecting Twilio.' : 'Connecting verifies your Twilio credentials and registers this messaging service as the number’s SMS webhook.'} Twilio messaging charges apply. Test incoming and outgoing messages before opening the channel to customers.</div></>}
      {type === 'line' && <><label>LINE channel ID<input name="line_channel_id" required pattern="[0-9]+" /></label><label>LINE channel secret<input name="line_channel_secret" type="password" required autoComplete="off" /></label><label>LINE channel access token<input name="line_channel_token" type="password" required autoComplete="off" /></label><div className="info-box">Use your LINE Official Account’s Messaging API credentials. After saving, enable webhooks in LINE Developers and set the callback to your public HTTPS messaging domain followed by /webhooks/line/ and your channel ID. Validate delivery with a real message.</div></>}
      {type === 'email' && <><label>Support email<input name="email" type="email" required /></label><label>Mailbox app password<input name="password" type="password" autoComplete="off" required /></label><div className="form-columns"><label>IMAP server (TLS, port 993)<input name="imap_address" required /></label><label>SMTP server (STARTTLS, port 587)<input name="smtp_address" required /></label></div><div className="info-box">Your mailbox must support IMAP and SMTP with an app password. OAuth-only mailboxes require the provider’s OAuth integration.</div></>}
      {type === 'api' && <><label>Reply webhook URL<input name="webhook_url" type="url" required /></label><div className="info-box">Connect your chatbot or custom channel with the messaging service’s public inbox API. Outgoing replies are dispatched to this webhook. Authenticate your integration and verify webhook signatures.</div></>}
    </>}
    <div className="modal-actions"><button className="button secondary" type="button" disabled={busy} onClick={createdInbox ? done : close}>{createdInbox ? 'View channels' : 'Cancel'}</button>{(type !== 'facebook' || facebook) && <button className="button primary" disabled={busy || !!createdInbox || publicUrlRequired || !!missingMeta || (type === 'facebook' && !facebook?.pages.some(p => !p.exists))}>{busy ? 'Connecting…' : type === 'instagram' ? 'Continue with Instagram' : 'Connect channel'}<ArrowRight size={15} /></button>}</div>
  </form></Modal>;
}
declare global { interface Window { FB?: { init: (data: { appId: string; version: string; cookie: boolean; xfbml: boolean }) => void; login: (callback: (data: { authResponse?: { accessToken: string } }) => void, options: { scope: string }) => void } } }

function InboxSettings({ inbox, close, done }: { inbox: Inbox; close: () => void; done: () => void }) {
  const [error, setError] = useState<Error>(), [busy, setBusy] = useState(false);
  const { data: agents } = useSWR<{ id: number; name: string }[]>('agents', api);
  const { data: members, error: membersError } = useSWR<{ payload: { id: number }[] }>(`inbox_members/${inbox.id}`, api);
  const { data: botsData } = useSWR<AgentBot[] | { payload: AgentBot[] }>('agent_bots', api);
  const { data: assignedBot, error: botError } = useSWR<{ agent_bot: AgentBot | null }>(`inboxes/${inbox.id}/agent_bot`, api);
  const bots = Array.isArray(botsData) ? botsData : botsData?.payload || [];
  const [botId, setBotId] = useState<string | null>(null);
  const selectedBotId = botId ?? String(assignedBot?.agent_bot?.id || '');
  const [checked, setChecked] = useState<number[] | null>(null);
  const selectedMembers = checked ?? members?.payload.map(agent => agent.id) ?? [];
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy) return; setBusy(true); setError(undefined);
    const form = new FormData(e.currentTarget);
    try { await api(`inboxes/${inbox.id}`, 'PATCH', { name: form.get('name'), greeting_enabled: form.get('greeting') === 'on', greeting_message: form.get('greeting_message'), enable_auto_assignment: form.get('auto') === 'on', csat_survey_enabled: form.get('csat') === 'on' }); await api('inbox_members', 'PATCH', { inbox_id: inbox.id, user_ids: selectedMembers }); if (selectedBotId !== String(assignedBot?.agent_bot?.id || '')) await api(`inboxes/${inbox.id}/set_agent_bot`, 'POST', { agent_bot: selectedBotId ? Number(selectedBotId) : null }); done(); } catch (e) { setError(e as Error); } finally { setBusy(false); }
  }
  return <Modal title={`${inbox.name} settings`} close={close} busy={busy}><ErrorNotice error={error || membersError || botError} /><form className="form-stack" onSubmit={save}><label>Inbox name<input name="name" required defaultValue={inbox.name} /></label><label className="checkbox-label"><input type="checkbox" name="greeting" defaultChecked={inbox.greeting_enabled} />Send a greeting to new conversations</label><label>Greeting message<textarea name="greeting_message" defaultValue={inbox.greeting_message || ''} /></label><label className="checkbox-label"><input type="checkbox" name="auto" defaultChecked={inbox.enable_auto_assignment} />Automatically assign conversations</label><label className="checkbox-label"><input type="checkbox" name="csat" defaultChecked={inbox.csat_survey_enabled} />Ask for customer satisfaction after resolution</label><fieldset><legend>Agents with inbox access</legend>{agents?.map(agent => <label className="checkbox-label" key={agent.id}><input type="checkbox" disabled={!members || !!membersError || busy} checked={selectedMembers.includes(agent.id)} onChange={e => setChecked(e.target.checked ? [...selectedMembers, agent.id] : selectedMembers.filter(id => id !== agent.id))} />{agent.name}</label>)}</fieldset><label>Agent bot<select aria-label="Agent bot" disabled={!assignedBot || !!botError || busy} value={selectedBotId} onChange={e => setBotId(e.target.value)}><option value="">No bot — team handles conversations</option>{bots.map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select></label><p className="muted">Create a bot connection in Automations, then assign it here. The bot receives real events for this inbox.</p><div className="modal-actions"><button type="button" className="button secondary" onClick={close} disabled={busy}>Cancel</button><button className="button primary" disabled={busy || !members || !assignedBot || !!membersError || !!botError}>{busy ? 'Saving…' : 'Save settings'}</button></div></form></Modal>;
}
function WidgetSnippet({ inbox, close }: { inbox: Inbox; close: () => void }) {
  const [copied, setCopied] = useState(false), [copyError, setCopyError] = useState(false);
  const safeJson = (value: string) => JSON.stringify(value).replaceAll('<', '\\u003c');
  const snippet = `<script>\n  (function(d,t) {\n    var BASE_URL=${safeJson(engine())};\n    var g=d.createElement(t),s=d.getElementsByTagName(t)[0];\n    g.src=BASE_URL+"/packs/js/sdk.js";\n    g.async=true;\n    s.parentNode.insertBefore(g,s);\n    g.onload=function() {\n      window.chatwootSDK.run({\n        websiteToken: ${safeJson(inbox.website_token!)},\n        baseUrl: BASE_URL\n      });\n    };\n  })(document,"script");\n</script>`;
  return <Modal title="Bring the conversation to your website" close={close}><p className="muted modal-description">Paste this snippet just before the closing body tag on your website.</p><pre className="code-block">{snippet}</pre>{copyError && <p role="alert">Copy is unavailable in this browser. Select and copy the snippet above.</p>}<div className="modal-actions"><Link className="button secondary" href={`/demo?token=${encodeURIComponent(inbox.website_token!)}`} target="_blank">Test real widget<ArrowUpRight size={15} /></Link><button className="button primary" onClick={async () => { try { await navigator.clipboard.writeText(snippet); setCopied(true); } catch { setCopyError(true); } }}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy snippet'}</button></div></Modal>;
}
