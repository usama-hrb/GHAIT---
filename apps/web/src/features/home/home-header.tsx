'use client';

import { PlusIcon, ShoppingCartIcon, TruckIcon } from 'lucide-react';
import Link from 'next/link';
import { messages } from '@/i18n';
import { DateText } from '@/shared/format';
import { Button } from '@/shared/ui/button';
import { useGreeting } from './use-shop-today';

const t = messages.home;

/**
 * Who is welcomed, the date, and the three things done most: Sell (the one gold action of the
 * screen), a purchase and an expense (not for a cashier, who only sells).
 */
export function HomeHeader({
  name,
  today,
  seesCosts,
}: {
  name: string | undefined;
  /** The shop's day (YYYY-MM-DD). */
  today: string;
  seesCosts: boolean;
}) {
  const greeting = t.greeting[useGreeting()];
  return (
    <header className="flex flex-col gap-4 @2xl:flex-row @2xl:items-end @2xl:justify-between">
      <div className="grid gap-1">
        <h2 className="font-heading text-2xl font-semibold text-balance">
          {name ? t.greetingFor(greeting, `\u2068${name}\u2069`) : greeting}
        </h2>
        <p className="text-sm text-muted-foreground">
          <DateText value={`${today}T12:00:00Z`} format="full" />
          <span aria-hidden> · </span>
          {t.subtitle}
        </p>
      </div>
      <div
        role="group"
        aria-label={t.quickActions}
        className="grid grid-cols-2 gap-2 @2xl:flex @2xl:items-center"
      >
        <Button asChild variant="accent" size="lg" className="col-span-2 @2xl:col-auto">
          <Link href="/pos">
            <ShoppingCartIcon data-icon="inline-start" aria-hidden />
            {t.sell}
          </Link>
        </Button>
        {seesCosts && (
          <>
            <Button asChild variant="outline" size="lg">
              <Link href="/inventory">
                <TruckIcon data-icon="inline-start" aria-hidden />
                {t.buy}
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/expenses">
                <PlusIcon data-icon="inline-start" aria-hidden />
                {t.expense}
              </Link>
            </Button>
          </>
        )}
      </div>
    </header>
  );
}
