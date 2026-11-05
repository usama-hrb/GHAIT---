'use client';

import { ChevronRightIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { messages } from '@/i18n';
import type { PayablesOverview, ReceivablesOverview, SalesOverview } from '@/local-db';
import { Money } from '@/shared/format';
import { Card, CardContent } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';

const t = messages.home;

/** One figure and what stands behind it; the whole card opens the page where it is worked on. */
function KpiCard({
  href,
  label,
  value,
  hint,
}: {
  href: string;
  label: string;
  /** undefined: still being read. */
  value: ReactNode | undefined;
  hint?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group/kpi rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Card
        size="sm"
        className="h-full transition-colors group-hover/kpi:bg-muted/50 group-focus-visible/kpi:bg-muted/50"
      >
        <CardContent className="grid gap-1">
          <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>{label}</span>
            <ChevronRightIcon
              aria-hidden
              className="size-4 shrink-0 opacity-60 rtl:rotate-180 group-hover/kpi:opacity-100"
            />
          </div>
          {value === undefined ? (
            <Skeleton className="my-0.5 h-7 w-28" />
          ) : (
            <p className="text-xl leading-tight font-semibold @sm:text-2xl">{value}</p>
          )}
          <div className="min-h-4 text-xs text-muted-foreground">{hint}</div>
        </CardContent>
      </Card>
    </Link>
  );
}

/**
 * The four figures of the business, each linked to its page: today's sales, today's gross profit
 * (only when the costs are known and for an account that sees them), what customers owe and what
 * the shop owes. Every number comes from the repository; nothing is added up here.
 */
export function KpiRow({
  seesCosts,
  sales,
  profit,
  receivables,
  payables,
}: {
  seesCosts: boolean;
  sales: SalesOverview | undefined;
  /** undefined: reading; null: cannot be worked out reliably, so the card is left out. */
  profit: number | null | undefined;
  receivables: ReceivablesOverview | undefined;
  payables: PayablesOverview | null | undefined;
}) {
  return (
    <section
      aria-label={t.overview}
      className="grid grid-cols-2 gap-3 @2xl:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] [&>*:last-child:nth-child(odd)]:max-@2xl:col-span-2"
    >
      <KpiCard
        href="/pos/history"
        label={t.todaySales}
        value={sales && <Money cents={sales.todayCents} />}
        hint={
          sales && (
            <>
              {t.salesCount(sales.todayCount)}
              {sales.yesterdayCents > 0 && (
                <>
                  <span aria-hidden> · </span>
                  {t.yesterday} <Money cents={sales.yesterdayCents} />
                </>
              )}
            </>
          )
        }
      />
      {seesCosts && profit !== null && (
        <KpiCard
          href="/reports"
          label={t.todayProfit}
          value={
            profit === undefined ? undefined : (
              <Money
                cents={profit}
                tone={profit > 0 ? 'profit' : profit < 0 ? 'loss' : undefined}
              />
            )
          }
          hint={t.profitHint}
        />
      )}
      <KpiCard
        href="/customers/debts"
        label={t.customerDebts}
        value={
          receivables && (
            <Money
              cents={receivables.owedCents}
              tone={receivables.owedCents > 0 ? 'debt' : undefined}
            />
          )
        }
        hint={receivables && t.customersOwing(receivables.owingCount)}
      />
      {seesCosts && payables !== null && (
        <KpiCard
          href="/payables"
          label={t.supplierDebts}
          value={
            payables && (
              <Money
                cents={payables.owedCents}
                tone={payables.owedCents > 0 ? 'debt' : undefined}
              />
            )
          }
          hint={payables && t.suppliersOwed(payables.owingCount)}
        />
      )}
    </section>
  );
}
