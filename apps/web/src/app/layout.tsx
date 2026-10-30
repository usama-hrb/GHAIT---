import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans_Arabic, Noto_Kufi_Arabic } from 'next/font/google';
import type { ReactNode } from 'react';
import { dir, locale, messages } from '@/i18n';
import { AppProviders } from './providers';
import './globals.css';

const bodyFont = IBM_Plex_Sans_Arabic({
  variable: '--font-body',
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
});

const headingFont = Noto_Kufi_Arabic({
  variable: '--font-heading',
  subsets: ['arabic', 'latin'],
  weight: ['500', '600', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: messages.app.name, template: `%s · ${messages.app.name}` },
  description: messages.app.description,
  applicationName: messages.app.name,
  appleWebApp: { capable: true, title: messages.app.name, statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  // --burgundy-800: the brand color behind the logo and the PWA splash screen.
  themeColor: '#491017',
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang={locale}
      dir={dir}
      className={`${bodyFont.variable} ${headingFont.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-svh">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
