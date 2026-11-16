import type { MetadataRoute } from 'next';
import { brand } from '@/lib/brand';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: brand.name,
    short_name: brand.shortName,
    description: brand.description,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: brand.backgroundColor,
    theme_color: brand.themeColor,
    categories: ['business', 'productivity'],
    icons: [
      { src: `${brand.iconDir}/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${brand.iconDir}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${brand.iconDir}/maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ],
    shortcuts: [
      { name: 'Shared inbox', url: '/inbox', icons: [{ src: `${brand.iconDir}/icon-192.png`, sizes: '192x192' }] },
      { name: 'Contacts', url: '/contacts', icons: [{ src: `${brand.iconDir}/icon-192.png`, sizes: '192x192' }] }
    ]
  };
}
