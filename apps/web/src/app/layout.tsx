import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Sans_Arabic, Noto_Kufi_Arabic } from 'next/font/google';
import type { ReactNode } from 'react';
import { DEFAULT_LANGUAGE, LANGUAGE_INFO, languageBootScript, messages } from '@/i18n';
import { AppProviders } from './providers';
import './globals.css';

const bodyFont = IBM_Plex_Sans_Arabic({
  variable: '--font-body',
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
});

// English text and headings (globals.css switches to it when <html lang="en">).
const englishFont = IBM_Plex_Sans({
  variable: '--font-body-en',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
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
    // The server always sends the default language; the script in <head> switches lang and dir to
    // the device's own choice before the first paint (hence suppressHydrationWarning).
    <html
      lang={DEFAULT_LANGUAGE}
      dir={LANGUAGE_INFO[DEFAULT_LANGUAGE].dir}
      className={`${bodyFont.variable} ${headingFont.variable} ${englishFont.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml -- our own constant (i18n/boot-script.ts), inline so it runs before the first paint */}
        <script dangerouslySetInnerHTML={{ __html: languageBootScript }} />
      </head>
      <body className="min-h-svh">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
