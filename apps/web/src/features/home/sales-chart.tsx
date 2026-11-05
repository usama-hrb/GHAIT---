'use client';

import { formatMoneyAmount } from '@fabric/core';
import { ArrowDownRightIcon, ArrowUpRightIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { messages } from '@/i18n';
import { type SalesWindow, useLiveQuery, useRepositories } from '@/local-db';
import { EmptyState } from '@/shared/brand';
import { formatDate, Money, moneyUnitLabel, useMoneyUnit } from '@/shared/format';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/shared/ui/chart';
import { useDirection } from '@/shared/ui/direction';
import { Skeleton } from '@/shared/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs';

const t = messages.home.chart;

const day = (date: string, format: 'dayMonth' | 'medium') =>
  formatDate(`${date}T12:00:00Z`, format);

/**
 * Sales by day for the last 7 or 30 days, net of goods given back (the profit report's own
 * definition), with the period's total and how it moved against the period before. One series,
 * as the reports charts; a table beside it for screen readers holds every number.
 */
export function SalesChart({ today, seesCosts }: { today: string; seesCosts: boolean }) {
  const repositories = useRepositories();
  const [period, setPeriod] = useState<SalesWindow>(7);
  const sales = useLiveQuery(
    () => repositories.home.sales(today, period),
    [repositories, today, period],
  );
  const { unit } = useMoneyUnit();
  const rtl = useDirection() === 'rtl';
  const config = {
    salesCents: { label: t.seriesLabel, color: 'var(--chart-1)' },
  } satisfies ChartConfig;
  const money = (value: unknown) =>
    typeof value === 'number' ? `${formatMoneyAmount(value, unit)} ${moneyUnitLabel(unit)}` : '';
  const tick = (value: unknown) =>
    typeof value === 'number' ? formatMoneyAmount(value, unit) : '';
  // Integer subtraction of two totals; shown only when there was something to compare with.
  const change =
    sales && sales.previousTotalCents > 0 ? sales.totalCents - sales.previousTotalCents : null;
  const empty = sales !== undefined && sales.totalCents === 0;

  return (
    <Card size="sm" className="min-w-0" role="region" aria-label={t.title}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <CardTitle className="font-heading text-base">{t.title}</CardTitle>
          {sales && !empty && (
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-xl font-semibold">
                <Money cents={sales.totalCents} />
              </span>
              {change !== null && change !== 0 && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  {change > 0 ? (
                    <ArrowUpRightIcon className="size-3.5 text-profit" aria-hidden />
                  ) : (
                    <ArrowDownRightIcon className="size-3.5 text-loss" aria-hidden />
                  )}
                  <span data-num>{change > 0 ? '+' : '−'}</span>
                  <Money cents={Math.abs(change)} />
                  {t.comparedTo}
                </span>
              )}
            </p>
          )}
        </div>
        <Tabs
          value={String(period)}
          onValueChange={(value) => {
            setPeriod(value === '30' ? 30 : 7);
          }}
        >
          <TabsList
            aria-label={t.period}
            className="group-data-horizontal/tabs:h-9 pointer-coarse:group-data-horizontal/tabs:h-12"
          >
            <TabsTrigger value="7">{t.last7}</TabsTrigger>
            <TabsTrigger value="30">{t.last30}</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        {sales === undefined ? (
          <Skeleton className="h-56 w-full @4xl:h-64" />
        ) : empty ? (
          <EmptyState
            title={t.empty}
            description={t.emptyHint}
            className="py-8"
            action={
              seesCosts ? (
                <Button asChild variant="outline" size="sm">
                  <Link href="/reports">{t.reports}</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <ChartContainer config={config} className="h-56 w-full @4xl:h-64">
              <BarChart data={sales.days} accessibilityLayer>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  reversed={rtl}
                  interval="preserveStartEnd"
                  minTickGap={period === 7 ? 8 : 24}
                  tickFormatter={(value: unknown) =>
                    typeof value === 'string' ? day(value, 'dayMonth') : ''
                  }
                />
                <YAxis
                  orientation={rtl ? 'right' : 'left'}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tickFormatter={tick}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(value: unknown) =>
                        typeof value === 'string' ? day(value, 'medium') : ''
                      }
                      formatter={(value) => money(value)}
                    />
                  }
                />
                <Bar dataKey="salesCents" fill="var(--color-salesCents)" radius={4} />
              </BarChart>
            </ChartContainer>
            <table className="sr-only">
              <caption>{t.tableLabel}</caption>
              <thead>
                <tr>
                  <th scope="col">{t.day}</th>
                  <th scope="col">{t.seriesLabel}</th>
                </tr>
              </thead>
              <tbody>
                {sales.days.map((row) => (
                  <tr key={row.date}>
                    <th scope="row">{day(row.date, 'medium')}</th>
                    <td>
                      <Money cents={row.salesCents} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
