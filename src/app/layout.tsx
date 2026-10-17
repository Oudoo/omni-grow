import type { Metadata } from 'next';
import { connection } from 'next/server';
import './globals.css';
import './business.css';
export const metadata: Metadata = { title: { default: 'OmniGrow — Every conversation, together', template: '%s · OmniGrow' }, description: 'One workspace for your customer conversations across every channel.' };
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Every page renders per request so the Content Security Policy nonce from src/proxy.ts is applied
  // to the framework's scripts. Static pages would be built once without a nonce.
  await connection();
  return <html lang="en"><body>{children}</body></html>;
}
