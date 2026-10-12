import { NextResponse } from 'next/server';
import { engineFetch } from '@/lib/server';
export async function GET() {
  try {
    const response = await engineFetch('/api');
    return NextResponse.json({ status: response.ok ? 'ok' : 'degraded', messaging: response.ok ? 'reachable' : 'unavailable' }, { status: response.ok ? 200 : 503 });
  } catch { return NextResponse.json({ status: 'degraded', messaging: 'unavailable' }, { status: 503 }); }
}
