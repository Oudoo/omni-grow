import { redirect, notFound } from 'next/navigation';
import { session, publicProfile } from '@/lib/server';
import { Workspace } from '@/components/workspace';
export default async function WorkspacePage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!['inbox', 'channels', 'contacts', 'reports', 'automation', 'settings'].includes(section)) notFound();
  const state = await session();
  if (!state.auth || !state.profile || !state.accountId) redirect('/login');
  return <Workspace section={section} initialProfile={publicProfile(state.profile, state.accountId)} />;
}
