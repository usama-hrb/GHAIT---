'use client';

import { breakdownOf } from '@fabric/contracts';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories } from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice } from '@/shared/brand';
import { DateAr, Money } from '@/shared/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Breakdown } from './breakdown';

const t = messages.settlements;

/**
 * One settlement (/settlements/view?id=…): its breakdown as approved, the split it used, what
 * each partner got, the shop's third kept as capital, and the costs it froze.
 */
export function SettlementDetailScreen() {
  const id = useSearchParams().get('id') ?? '';
  const repositories = useRepositories();
  const view = useLiveQuery(
    async () => (await repositories.settlements.detail(id)) ?? null,
    [repositories, id],
  );

  if (view === undefined) return <LoadingState />;
  if (view === null) {
    return (
      <EmptyState
        title={t.notFound}
        action={
          <Button asChild variant="outline">
            <Link href="/settlements">{t.back}</Link>
          </Button>
        }
      />
    );
  }
  const { settlement } = view;

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <OfflineNotice />
      <Button asChild variant="link" className="justify-self-start px-0">
        <Link href="/settlements">{t.back}</Link>
      </Button>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-heading text-xl font-semibold">
          <DateAr value={settlement.periodStart} /> – <DateAr value={settlement.periodEnd} />
        </h2>
        <Badge variant={settlement.voidedAt ? 'outline' : 'secondary'}>
          {settlement.voidedAt ? t.unlocked : t.locked}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {t.lockedAt} <DateAr value={settlement.lockedAt} format="dateTime" />
      </p>
      <section aria-label={t.newTitle} className="rounded-xl border bg-card p-4">
        <Breakdown lines={breakdownOf(settlement)} />
        <p className="mt-3 text-sm text-muted-foreground">
          {t.weights}: {t.owner} <bdi data-num>{settlement.ownerWeight}</bdi> · {t.partner}{' '}
          <bdi data-num>{settlement.partnerWeight}</bdi> · {t.shop}{' '}
          <bdi data-num>{settlement.shopWeight}</bdi>
        </p>
      </section>
      {[
        { title: t.sharesTitle, rows: view.shares },
        { title: t.retainedTitle, rows: view.retainedProfit },
      ].map(
        ({ title, rows }) =>
          rows.length > 0 && (
            <section key={title} aria-label={title} className="grid gap-2">
              <h3 className="font-heading font-semibold">{title}</h3>
              <dl className="grid gap-1 rounded-lg border bg-card p-4">
                {rows.map((row) => (
                  <div key={row.id} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{row.partner?.name}</dt>
                    <dd>
                      <Money cents={row.amountCents} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ),
      )}
      <p className="text-sm text-muted-foreground">
        {t.frozenCosts}: <bdi data-num>{view.lockedCostCount}</bdi>
      </p>
    </div>
  );
}
