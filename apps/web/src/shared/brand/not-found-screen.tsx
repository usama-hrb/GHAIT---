'use client';

import Link from 'next/link';
import { messages } from '@/i18n';
import { LanguageToggle } from '@/shared/language';
import { ThemeToggle } from '@/shared/theme';
import { Button } from '@/shared/ui/button';
import { DiamondBullet } from './diamond-bullet';
import { Logo } from './logo';

/**
 * The page for an address that matches no screen of the app. It stands alone: no sidebar and
 * nothing read from the device's database, so it opens the same for someone signed in, signed out
 * or offline. Its one way out is the home screen, which sends a signed-out visitor on to the
 * sign-in page. Language and theme can be changed here, as on the sign-in page.
 */
export function NotFoundScreen() {
  const t = messages.notFound;
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-2 px-4 py-3 sm:px-6">
        <Logo className="w-28" priority />
        <div className="flex items-center gap-1">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </header>
      <main
        id="content"
        className="flex flex-1 items-center justify-center px-4 pt-4 pb-16 sm:px-8"
      >
        <div className="grid max-w-md justify-items-center gap-4 text-center">
          {/* The code is part of the picture; the heading below is what a screen reader reads. */}
          <p
            aria-hidden
            dir="ltr"
            className="font-heading text-7xl leading-none font-semibold text-primary sm:text-8xl"
          >
            {t.code}
          </p>
          <DiamondBullet className="text-lg" />
          <h1 className="font-heading text-2xl font-semibold text-balance">{t.title}</h1>
          {/* Foreground at 80%, not muted: the muted token is 4.48:1 on the page, a hair under AA. */}
          <p className="text-pretty text-foreground/80">{t.description}</p>
          <Button asChild variant="accent" size="lg" className="mt-2">
            <Link href="/home">{t.backToHome}</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
