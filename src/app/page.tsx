import { redirect } from 'next/navigation';
import { session, sessionIsActive } from '@/lib/server';
export default async function Home() { const state = await session(); redirect(sessionIsActive(state) ? '/inbox' : '/login'); }
