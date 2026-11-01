'use client';

import { SerwistProvider } from '@serwist/turbopack/react';
import type { ReactNode } from 'react';
import { SettingsMoneyUnitProvider } from '@/features/settings';
import { LocalDbProvider } from '@/local-db';
import { LanguageBoundary, LanguageProvider, useLanguage } from '@/shared/language';
import { ThemeProvider } from '@/shared/theme';
import { Toaster } from '@/shared/ui/sonner';
import { TooltipProvider } from '@/shared/ui/tooltip';

/** Toasts open in the "end" corner: on desktop that keeps them off the sidebar, which sits at the start. */
function AppToaster() {
  const { dir } = useLanguage();
  return <Toaster dir={dir} position={dir === 'rtl' ? 'bottom-left' : 'bottom-right'} />;
}

/**
 * Client-side context for the whole app: the service worker (app shell offline; off under
 * `next dev`), the language and its direction, the local database and sync, and the money unit
 * from settings. A language change remounts only what is inside LanguageBoundary.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    // No reload when the connection comes back (Serwist's default): it would throw away a form
    // being filled in, and sync resumes by itself on the `online` event.
    <SerwistProvider
      swUrl="/serwist/sw.js"
      disable={process.env.NODE_ENV === 'development'}
      reloadOnOnline={false}
    >
      <ThemeProvider>
        <LanguageProvider>
          <TooltipProvider>
            <LocalDbProvider>
              <SettingsMoneyUnitProvider>
                <LanguageBoundary>{children}</LanguageBoundary>
                <AppToaster />
              </SettingsMoneyUnitProvider>
            </LocalDbProvider>
          </TooltipProvider>
        </LanguageProvider>
      </ThemeProvider>
    </SerwistProvider>
  );
}
