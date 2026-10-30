import type { MetadataRoute } from 'next';
import { dir, locale, messages } from '@/i18n';

// --burgundy-800: splash screen and browser chrome match the logo background.
const BRAND_BURGUNDY = '#491017';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: messages.app.name,
    short_name: messages.app.name,
    description: messages.app.description,
    lang: locale,
    dir,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    theme_color: BRAND_BURGUNDY,
    background_color: BRAND_BURGUNDY,
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/brand/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
