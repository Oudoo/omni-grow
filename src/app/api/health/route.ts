import { NextResponse } from 'next/server';
import { engineFetch } from '@/lib/server';
// Probes the engine's dedicated health route, which Chatwoot exempts from rate limiting. Probing an
// ordinary API path would spend the engine's per-address request budget on every health check.
export async function GET() {
  try {
    const response = await engineFetch('/health');
    return NextResponse.json({ status: response.ok ? 'ok' : 'degraded', messaging: response.ok ? 'reachable' : 'unavailable' }, { status: response.ok ? 200 : 503 });
  } catch { return NextResponse.json({ status: 'degraded', messaging: 'unavailable' }, { status: 503 }); }
}
