'use client';
import { useEffect, useState } from 'react';
import { LiveKitRoom, PreJoin, VideoConference, type LocalUserChoices } from '@livekit/components-react';
import '@livekit/components-styles';
import { businessApi } from '@/lib/business-client';
import type { MeetingAdmission, TeamMeeting } from '@/lib/business-types';
import { ErrorNotice } from './ui';

export function TeamMeetingPanel({ meeting, name, canEnd, close, ended }: { meeting: TeamMeeting; name: string; canEnd: boolean; close: () => void; ended: () => void }) {
  const [admission, setAdmission] = useState<MeetingAdmission>(), [choices, setChoices] = useState<LocalUserChoices>(), [busy, setBusy] = useState(false), [connected, setConnected] = useState(false), [error, setError] = useState<Error>(), [secure, setSecure] = useState(true);
  useEffect(() => { setSecure(window.isSecureContext); }, []);
  useEffect(() => {
    if (!admission) return;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const result = await businessApi<{ meeting: TeamMeeting | null }>(`rooms/${meeting.room_id}`);
        if (alive && result.meeting?.id !== meeting.id) { setAdmission(undefined); setError(new Error('This meeting has ended.')); }
      } catch { if (alive) { setAdmission(undefined); setError(new Error('Meeting access could not be verified. Rejoin after your connection is restored.')); } }
    }, 15000);
    return () => { alive = false; clearInterval(timer); };
  }, [admission, meeting]);
  async function join(values: LocalUserChoices) {
    if (busy) return; setBusy(true); setError(undefined);
    try { const result = await businessApi<MeetingAdmission>(`rooms/${meeting.room_id}/meetings/${meeting.id}/join`, 'POST'); setChoices(values); setAdmission(result); }
    catch (error) { setError(error as Error); } finally { setBusy(false); }
  }
  async function end() {
    if (busy) return; setBusy(true); setError(undefined);
    try { await businessApi(`rooms/${meeting.room_id}/meetings/${meeting.id}`, 'DELETE'); setAdmission(undefined); ended(); close(); }
    catch (error) { setError(error as Error); } finally { setBusy(false); }
  }
  return <div className="team-meeting-overlay" role="dialog" aria-modal="true" aria-label="Team meeting"><header className="team-meeting-header"><div><strong>Team meeting</strong><span role="status">{admission ? connected ? 'Connected' : 'Connecting…' : 'Check your camera and microphone'}</span></div><div>{canEnd && <button className="button secondary" disabled={busy} onClick={end}>End for everyone</button>}<button className="button secondary" onClick={close}>{admission ? 'Leave meeting' : 'Close'}</button></div></header><ErrorNotice error={error} />{!secure ? <p className="meeting-notice">Open OmniGrow over HTTPS to use your camera, microphone and screen sharing. Same-computer localhost testing is also supported.</p> : admission ? <LiveKitRoom data-lk-theme="default" serverUrl={admission.url} token={admission.token} audio={choices?.audioEnabled ? { deviceId: choices.audioDeviceId } : false} video={choices?.videoEnabled ? { deviceId: choices.videoDeviceId } : false} onConnected={() => setConnected(true)} onDisconnected={() => { setAdmission(undefined); setConnected(false); }} onError={error => setError(new Error(error.message))} onMediaDeviceFailure={() => setError(new Error('A media device could not be opened. Check browser permissions or choose another device.'))} options={{ adaptiveStream: true, dynacast: true }}><VideoConference /></LiveKitRoom> : <div className="meeting-lobby" aria-busy={busy}><PreJoin defaults={{ username: name, audioEnabled: false, videoEnabled: false }} persistUserChoices={false} onSubmit={join} onError={error => setError(error)} joinLabel={busy ? 'Joining…' : 'Join meeting'} /><p className="muted small">Meeting chat is available while the call is open. Use the team channel for messages and documents you need to keep.</p></div>}</div>;
}
