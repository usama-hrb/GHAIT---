'use client';

import { SerwistProvider } from '@serwist/turbopack/react';
import type { ReactNode } from 'react';
import { SettingsMoneyUnitProvider } from '@/features/settings';
import { dir } from '@/i18n';
import { LocalDbProvider } from '@/local-db';
import { ThemeProvider } from '@/shared/theme';
import { DirectionProvider } from '@/shared/ui/direction';
import { Toaster } from '@/shared/ui/sonner';
import { TooltipProvider } from '@/shared/ui/tooltip';

/**
 * Client-side context for the whole app: the service worker (app shell offline; off under
 * `next dev`), the local database and sync, and the money unit from settings.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SerwistProvider swUrl="/serwist/sw.js" disable={process.env.NODE_ENV === 'development'}>
      <ThemeProvider>
        <DirectionProvider dir={dir}>
          <TooltipProvider>
            <LocalDbProvider>
              <SettingsMoneyUnitProvider>
                {children}
                {/* RTL: the "end" corner is the left; on desktop that keeps toasts off the sidebar. */}
                <Toaster dir={dir} position="top-left" />
              </SettingsMoneyUnitProvider>
            </LocalDbProvider>
          </TooltipProvider>
        </DirectionProvider>
      </ThemeProvider>
    </SerwistProvider>
  );
}
