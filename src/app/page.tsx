import { redirect } from 'next/navigation';
import { session } from '@/lib/server';
export default async function Home() { const state = await session(); redirect(state.auth ? '/inbox' : '/login'); }
