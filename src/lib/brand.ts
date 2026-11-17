// Build-time branding. NEXT_PUBLIC_BRAND is inlined when the app is built, so a
// deployment chooses its brand with a Docker build argument, not at runtime.
export interface Brand {
  id: 'omnigrow' | 'aboteeg';
  /** Full product name shown in titles and the install dialog. */
  name: string;
  /** Home-screen label (keep it under ~12 characters). */
  shortName: string;
  /** Large wordmark in the sidebar and sign-in screen. */
  wordmark: string;
  /** Optional line under the wordmark. */
  subtitle?: string;
  description: string;
  themeColor: string;
  backgroundColor: string;
  /** Directory under public/ holding icon.svg, icon-192.png, icon-512.png, maskable-512.png and apple-touch-icon.png. */
  iconDir: string;
  /** Shown on white-label deployments so the engine remains attributable. */
  poweredBy?: string;
}

const brands: Record<Brand['id'], Brand> = {
  omnigrow: {
    id: 'omnigrow',
    name: 'OmniGrow',
    shortName: 'OmniGrow',
    wordmark: 'OmniGrow',
    description: 'One workspace for your customer conversations across every channel.',
    themeColor: '#167b62',
    backgroundColor: '#f7f9f6',
    iconDir: '/brands/omnigrow'
  },
  aboteeg: {
    id: 'aboteeg',
    name: 'Abo Teeg Pharmacy',
    shortName: 'Abo Teeg',
    wordmark: 'Abo Teeg',
    subtitle: 'Pharmacy',
    description: 'Every customer conversation with Abo Teeg Pharmacy in one shared inbox.',
    themeColor: '#167b62',
    backgroundColor: '#f7f9f6',
    iconDir: '/brands/aboteeg',
    poweredBy: 'Powered by OmniGrow'
  }
};

export const brand: Brand = brands[process.env.NEXT_PUBLIC_BRAND as Brand['id']] ?? brands.omnigrow;
