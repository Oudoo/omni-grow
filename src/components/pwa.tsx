'use client';
import { useEffect, useState } from 'react';
import { Download, Share, SquarePlus, X } from 'lucide-react';
import { brand } from '@/lib/brand';
import { Modal } from './ui';

interface InstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
const dismissedKey = 'og:install-card-dismissed';

export function ServiceWorkerRegistration() {
  useEffect(() => {
    // Development builds change constantly; only production registers the worker.
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => { /* The app works without it. */ });
  }, []);
  return null;
}

function useInstall() {
  const [prompt, setPrompt] = useState<InstallPromptEvent>();
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(true);
  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) return;
    setInstalled(false);
    // iPadOS reports a desktop platform; touch support distinguishes it.
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
    const capture = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPromptEvent); };
    const done = () => { setPrompt(undefined); setInstalled(true); };
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', done);
    return () => { window.removeEventListener('beforeinstallprompt', capture); window.removeEventListener('appinstalled', done); };
  }, []);
  async function install() {
    if (!prompt) return false;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    setPrompt(undefined);
    if (choice.outcome === 'accepted') setInstalled(true);
    return true;
  }
  return { available: !installed && (Boolean(prompt) || ios), ios: !prompt && ios, install };
}

function IosSteps() {
  return <ol className="install-steps"><li><Share size={16} />Tap <strong>Share</strong> in the browser toolbar.</li><li><SquarePlus size={16} />Choose <strong>Add to Home Screen</strong>.</li><li><Download size={16} />Tap <strong>Add</strong>. {brand.shortName} opens like an app.</li></ol>;
}

/** Sign-in screen card. Can be dismissed; the sidebar entry remains. */
export function InstallCard() {
  const { available, ios, install } = useInstall();
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => { try { setDismissed(localStorage.getItem(dismissedKey) === '1'); } catch { setDismissed(false); } }, []);
  if (!available || dismissed) return null;
  function dismiss() { setDismissed(true); try { localStorage.setItem(dismissedKey, '1'); } catch { /* Storage may be disabled. */ } }
  return <aside className="install-card" aria-label={`Install ${brand.name}`}>
    <img src={`${brand.iconDir}/icon-192.png`} alt="" width={40} height={40} />
    <div><strong>Install {brand.shortName} on this device</strong>{ios ? <IosSteps /> : <p>Open it from your home screen or dock, in its own window.</p>}</div>
    {!ios && <button type="button" className="button primary" onClick={install}><Download size={16} />Install</button>}
    <button type="button" className="icon-button install-dismiss" aria-label="Dismiss install suggestion" onClick={dismiss}><X size={16} /></button>
  </aside>;
}

/** Sidebar entry, shown whenever the app can be installed. */
export function InstallNavItem() {
  const { available, ios, install } = useInstall();
  const [help, setHelp] = useState(false);
  if (!available) return null;
  return <>
    <button type="button" className="nav-item install-nav" aria-label={`Install ${brand.shortName} app`} onClick={() => { if (ios) setHelp(true); else void install(); }}><Download size={19} /><span>Install app</span></button>
    {help && <Modal title={`Install ${brand.shortName}`} close={() => setHelp(false)}><p className="modal-description">Add {brand.name} to your home screen to open it like an app.</p><IosSteps /></Modal>}
  </>;
}
