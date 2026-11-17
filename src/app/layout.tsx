import type { Metadata, Viewport } from 'next';
import { brand } from '@/lib/brand';
import { ServiceWorkerRegistration } from '@/components/pwa';
import './globals.css';
export const metadata: Metadata = {
  title: { default: brand.id === 'omnigrow' ? 'OmniGrow — Every conversation, together' : brand.name, template: `%s · ${brand.name}` },
  description: brand.description,
  applicationName: brand.name,
  appleWebApp: { capable: true, title: brand.shortName, statusBarStyle: 'default' },
  icons: { icon: [{ url: `${brand.iconDir}/icon.svg`, type: 'image/svg+xml' }, { url: `${brand.iconDir}/icon-192.png`, sizes: '192x192', type: 'image/png' }], apple: `${brand.iconDir}/apple-touch-icon.png` }
};
export const viewport: Viewport = { themeColor: brand.themeColor };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}<ServiceWorkerRegistration /></body></html>;
}
