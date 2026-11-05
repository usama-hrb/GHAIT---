'use client';

import type { ReactNode } from 'react';
import { messages } from '@/i18n';
import { DiamondBullet, Logo } from '@/shared/brand';
import { LanguageToggle } from '@/shared/language';
import { cn } from '@/shared/lib/utils';
import { ThemeToggle } from '@/shared/theme';

/**
 * The frame of the sign-in and sign-up pages. On a wide screen the left column (the right one in
 * Arabic) is the brand on burgundy and the form sits beside it; on a phone or a narrow tablet the
 * brand shrinks to the logo above the form. Language and theme can be changed here, before
 * anyone is signed in. `wide` gives a longer form (sign-up) more room.
 */
export function AuthLayout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const t = messages.auth.brand;
  return (
    <div className="grid min-h-svh bg-background text-foreground lg:grid-cols-[5fr_6fr]">
      <aside className="relative hidden flex-col justify-between bg-burgundy-800 p-10 text-sidebar-foreground lg:flex xl:p-14">
        <Logo className="w-52" priority />
        <div className="grid max-w-md gap-8">
          <p className="font-heading text-3xl leading-tight font-semibold text-balance xl:text-4xl">
            {t.headline}
          </p>
          <ul className="grid gap-4 text-base text-sidebar-foreground/85">
            {[t.till, t.books, t.partners].map((line) => (
              <li key={line} className="flex items-start gap-3">
                <DiamondBullet className="mt-2 shrink-0 text-xs" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
        <span aria-hidden className="h-px w-16 bg-sidebar-foreground/30" />
      </aside>
      <div className="flex min-h-svh min-w-0 flex-col">
        <header className="flex items-center justify-between gap-2 px-4 py-3 sm:px-6 lg:justify-end">
          <Logo className="w-28 lg:hidden" priority />
          <div className="flex items-center gap-1">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </header>
        <main className="flex flex-1 items-start justify-center px-4 pt-4 pb-10 sm:items-center sm:px-8 sm:pt-0">
          <div className={cn('w-full', wide ? 'max-w-xl' : 'max-w-sm')}>{children}</div>
        </main>
      </div>
    </div>
  );
}
