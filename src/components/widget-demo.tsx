'use client';
import { useEffect, useState } from 'react';
import { ArrowDownRight, Globe2, MessageCircle } from 'lucide-react';
declare global { interface Window { chatwootSDK?: { run: (options: { websiteToken: string; baseUrl: string }) => void }; $chatwoot?: { toggle: (state?: string) => void }; chatwootSettings?: Record<string, unknown> } }
export function WidgetDemo({ token }: { token: string }) {
  const [error, setError] = useState(false);
  useEffect(() => {
    const baseUrl = process.env.NEXT_PUBLIC_ENGINE_URL || 'http://localhost:3001';
    window.chatwootSettings = { position: 'right', launcherTitle: 'Talk to us', locale: 'en' };
    const script = document.createElement('script'); script.src = `${baseUrl}/packs/js/sdk.js`; script.async = true;
    script.onload = () => window.chatwootSDK?.run({ websiteToken: token, baseUrl });
    script.onerror = () => setError(true);
    document.body.appendChild(script);
    return () => { script.remove(); };
  }, [token]);
  return <main className="demo-page"><div className="demo-logo"><span className="brand-mark">og<span>↗</span></span><strong>OmniGrow<span className="brand-dot">.</span></strong></div><span className="eyebrow">A REAL CONVERSATION STARTS HERE</span><h1>Your website.<br />A little more human.</h1><p>This page runs your actual website chat channel.<br />Send a message in the widget, then reply from your shared inbox.</p><div className="demo-steps"><div><Globe2 size={22} /><strong>1. Open the chat</strong><p>Use the chat button below.</p></div><div><MessageCircle size={22} /><strong>2. Say hello</strong><p>Your message creates a real conversation.</p></div><div><ArrowDownRight size={22} /><strong>3. Reply from OmniGrow</strong><p>The response arrives in this widget.</p></div></div>{error && <div className="alert error" role="alert">The widget could not load. Check that the messaging service is reachable from your browser.</div>}<span className="demo-footnote">This is a working channel. Messages are saved in your workspace.</span></main>;
}
