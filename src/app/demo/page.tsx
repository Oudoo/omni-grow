import { WidgetDemo } from '@/components/widget-demo';
export default async function Demo({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token || !/^[a-zA-Z0-9_-]{10,100}$/.test(token)) return <main className="demo-page"><h1>Choose a website channel first.</h1><p>Open Channels → Install widget → Test real widget.</p></main>;
  return <WidgetDemo token={token} />;
}
