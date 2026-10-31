'use client';

import { PlusIcon, ShoppingCartIcon, TruckIcon } from 'lucide-react';
import Link from 'next/link';
import { ExpenseReminders } from '@/features/expenses';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories } from '@/local-db';
import { LoadingState, OfflineNotice } from '@/shared/brand';
import { Meters, Money } from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';
import { Button } from '@/shared/ui/button';

const t = messages.home;

/**
 * The home screen (SPEC §14.1): today's sales, bills due, colours running low, overdue debts,
 * and shortcuts. Everything from the device's data, offline too.
 */
export function HomeScreen() {
  const repositories = useRepositories();
  const data = useLiveQuery(async () => {
    const today = shopToday();
    const [sales, stock, debts] = await Promise.all([
      repositories.sales.list(),
      repositories.inventory.overview(),
      repositories.accounts.debts('oldest'),
    ]);
    const todays = sales.filter(
      (summary) => summary.sale.date === today && summary.sale.voidedAt === null,
    );
    return {
      salesCount: todays.length,
      salesCents: todays.reduce((sum, summary) => sum + summary.sale.totalCents, 0),
      low: stock.fabrics.flatMap((fabric) =>
        fabric.colors
          .filter((color) => color.state === 'low')
          .map((color) => ({ fabric: fabric.fabric, color })),
      ),
      overdue: debts.filter((debt) => debt.account.overdueCents > 0),
    };
  }, [repositories]);

  if (data === undefined) return <LoadingState />;
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4">
      <OfflineNotice />
      <h2 className="font-heading text-xl font-semibold">{t.title}</h2>

      <section aria-label={t.shortcuts} className="flex flex-wrap gap-2">
        <Button asChild variant="accent" size="lg">
          <Link href="/pos">
            <ShoppingCartIcon aria-hidden />
            {t.sell}
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/purchases/new">
            <TruckIcon aria-hidden />
            {t.buy}
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/expenses">
            <PlusIcon aria-hidden />
            {t.expense}
          </Link>
        </Button>
      </section>

      <section aria-label={t.todaySales} className="grid gap-1 rounded-xl border bg-card p-4">
        <h3 className="font-heading font-semibold">{t.todaySales}</h3>
        <p className="text-2xl font-semibold">
          <Money cents={data.salesCents} />
        </p>
        <p className="text-sm text-muted-foreground">{t.salesCount(data.salesCount)}</p>
      </section>

      <ExpenseReminders />

      <div className="grid gap-4 md:grid-cols-2">
        <section
          aria-label={t.lowStock}
          className="grid content-start gap-2 rounded-xl border bg-card p-4"
        >
          <h3 className="font-heading font-semibold">{t.lowStock}</h3>
          {data.low.length === 0 ? (
            <p className="text-muted-foreground">{t.noLowStock}</p>
          ) : (
            <ul className="grid gap-1">
              {data.low.slice(0, 8).map(({ fabric, color }) => (
                <li key={color.variant.id} className="flex justify-between gap-2">
                  <Link
                    href={`/inventory/color?id=${color.variant.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {fabric.name} · {color.variant.colorName}
                  </Link>
                  <Meters cm={color.remainingCm} />
                </li>
              ))}
            </ul>
          )}
          <Button asChild variant="link" className="justify-self-start px-0">
            <Link href="/inventory">{t.seeAll}</Link>
          </Button>
        </section>

        <section
          aria-label={t.overdueDebts}
          className="grid content-start gap-2 rounded-xl border bg-card p-4"
        >
          <h3 className="font-heading font-semibold">{t.overdueDebts}</h3>
          {data.overdue.length === 0 ? (
            <p className="text-muted-foreground">{t.noOverdue}</p>
          ) : (
            <ul className="grid gap-1">
              {data.overdue.slice(0, 8).map(({ customer, account }) => (
                <li key={customer.id} className="flex justify-between gap-2">
                  <Link
                    href={`/customers/view?id=${customer.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {customer.name}
                  </Link>
                  <Money cents={account.overdueCents} tone="debt" />
                </li>
              ))}
            </ul>
          )}
          <Button asChild variant="link" className="justify-self-start px-0">
            <Link href="/customers/debts">{t.seeAll}</Link>
          </Button>
        </section>
      </div>
    </div>
  );
}
