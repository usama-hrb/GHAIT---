'use client';

import { monthBounds, monthOf, previousMonth } from '@fabric/core';
import { useId, useState } from 'react';
import { categoryName } from '@/features/expenses';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories } from '@/local-db';
import { LoadingState, OfflineNotice } from '@/shared/brand';
import { formatDate } from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';
import { Field, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { MoneyBars } from './report-chart';
import { ReportTable } from './report-table';

const t = messages.reports;
const c = t.columns;

/** The expense rows with each category named in the language shown. */
function named<T extends { category: string; label: string }>(rows: readonly T[]): T[] {
  return rows.map((row) => ({
    ...row,
    label: categoryName({ key: row.category, label: row.label }),
  }));
}

/** The first day of the month five months back: six months of figures by default. */
function sixMonthsAgo(): string {
  let month = monthOf(shopToday());
  for (let step = 0; step < 5; step++) month = previousMonth(month);
  return monthBounds(month).start;
}

/**
 * Reports (SPEC §14.13, BUILD_PROMPTS 5.2): profit, what sells and what does not, negotiation,
 * expenses, who owes and since when, stock value, the money. From this device's records, so
 * offline too; each table exports as CSV.
 */
export function ReportsScreen() {
  const id = useId();
  const repositories = useRepositories();
  const [from, setFrom] = useState(sixMonthsAgo);
  const [to, setTo] = useState(() => shopToday());
  const data = useLiveQuery(
    () => (from <= to ? repositories.reports.all({ from, to }) : Promise.resolve(null)),
    [repositories, from, to],
  );
  const monthName = (month: string) => formatDate(`${month}-01`, 'month');

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4">
      <OfflineNotice />
      <h2 className="font-heading text-xl font-semibold">{t.title}</h2>
      <div className="flex flex-wrap gap-3">
        <Field className="max-w-48">
          <FieldLabel htmlFor={`${id}-from`}>{t.from}</FieldLabel>
          <Input
            id={`${id}-from`}
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
            }}
          />
        </Field>
        <Field className="max-w-48">
          <FieldLabel htmlFor={`${id}-to`}>{t.to}</FieldLabel>
          <Input
            id={`${id}-to`}
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
            }}
          />
        </Field>
      </div>
      {data === undefined ? (
        <LoadingState />
      ) : data === null ? (
        <p className="text-muted-foreground">{t.badRange}</p>
      ) : (
        <Tabs defaultValue="profit">
          {/* Eight tabs wrap onto a second row in English: the list and its tabs take their height from the content (the default is one fixed row). */}
          <TabsList className="flex-wrap group-data-horizontal/tabs:h-auto">
            {(
              [
                'profit',
                'products',
                'slow',
                'negotiation',
                'expenses',
                'receivables',
                'stock',
                'cash',
              ] as const
            ).map((tab) => (
              <TabsTrigger key={tab} value={tab} className="h-auto py-1">
                {t.tabs[tab]}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="profit" className="grid gap-4">
            <MoneyBars
              title={t.charts.netByMonth}
              label={c.netProfit}
              data={data.profit.map((row) => ({
                name: monthName(row.month),
                cents: row.netProfitCents,
              }))}
            />
            <ReportTable
              title={t.tabs.profit}
              file="profit-by-month"
              rows={data.profit}
              columns={[
                { key: 'month', label: c.month, kind: 'month' },
                { key: 'salesCents', label: c.sales, kind: 'money' },
                { key: 'grossProfitCents', label: c.grossProfit, kind: 'money' },
                { key: 'recognizedProfitCents', label: c.recognized, kind: 'money' },
                { key: 'lossesCents', label: c.losses, kind: 'money' },
                { key: 'expensesCents', label: c.expenses, kind: 'money' },
                { key: 'cashOverShortCents', label: c.cashOverShort, kind: 'money' },
                { key: 'netProfitCents', label: c.netProfit, kind: 'money' },
              ]}
            />
            <p className="text-sm text-muted-foreground">{t.profitHint}</p>
          </TabsContent>

          <TabsContent value="products" className="grid gap-4">
            <ReportTable
              title={t.byFabric}
              file="sales-by-fabric"
              rows={data.fabrics}
              columns={[
                { key: 'fabricName', label: c.fabric, kind: 'text' },
                { key: 'soldCm', label: c.sold, kind: 'meters' },
                { key: 'revenueCents', label: c.revenue, kind: 'money' },
                { key: 'costCents', label: c.cost, kind: 'money' },
                { key: 'profitCents', label: c.profit, kind: 'money' },
              ]}
            />
            <ReportTable
              title={t.byColor}
              file="sales-by-color"
              rows={data.colors}
              columns={[
                { key: 'fabricName', label: c.fabric, kind: 'text' },
                { key: 'colorName', label: c.color, kind: 'text' },
                { key: 'soldCm', label: c.sold, kind: 'meters' },
                { key: 'revenueCents', label: c.revenue, kind: 'money' },
                { key: 'profitCents', label: c.profit, kind: 'money' },
              ]}
            />
          </TabsContent>

          <TabsContent value="slow" className="grid gap-4">
            <ReportTable
              title={t.tabs.slow}
              file="slow-moving"
              rows={data.slow}
              columns={[
                { key: 'fabricName', label: c.fabric, kind: 'text' },
                { key: 'colorName', label: c.color, kind: 'text' },
                { key: 'remainingCm', label: c.left, kind: 'meters' },
                { key: 'costCents', label: c.atCost, kind: 'money' },
                { key: 'lastSale', label: c.lastSale, kind: 'date' },
                { key: 'daysIdle', label: c.daysIdle, kind: 'days' },
              ]}
            />
          </TabsContent>

          <TabsContent value="negotiation" className="grid gap-4">
            <p className="text-sm text-muted-foreground">{t.negotiationHint}</p>
            {(
              [
                [
                  t.byCustomer,
                  'negotiation-by-customer',
                  data.byCustomer.map((row) => ({ ...row, name: row.name || t.walkIn })),
                ],
                [t.byFabric, 'negotiation-by-fabric', data.byFabric],
              ] as const
            ).map(([title, file, rows]) => (
              <ReportTable
                key={file}
                title={title}
                file={file}
                rows={rows}
                columns={[
                  { key: 'name', label: c.name, kind: 'text' },
                  { key: 'lines', label: c.lines, kind: 'count' },
                  { key: 'refCents', label: c.atReference, kind: 'money' },
                  { key: 'soldCents', label: c.soldFor, kind: 'money' },
                  { key: 'discountCents', label: c.discount, kind: 'money' },
                  { key: 'discountBp', label: c.discountRate, kind: 'percent' },
                ]}
              />
            ))}
          </TabsContent>

          <TabsContent value="expenses" className="grid gap-4">
            <MoneyBars
              title={t.charts.expenses}
              label={c.amount}
              layout="horizontal-bars"
              data={named(data.expenses).map((row) => ({
                name: row.label,
                cents: row.amountCents,
              }))}
            />
            <ReportTable
              title={t.tabs.expenses}
              file="expenses-by-category"
              rows={named(data.expenses)}
              columns={[
                { key: 'label', label: c.category, kind: 'text' },
                { key: 'amountCents', label: c.amount, kind: 'money' },
              ]}
            />
          </TabsContent>

          <TabsContent value="receivables" className="grid gap-4">
            <ReportTable
              title={t.tabs.receivables}
              file="receivables-ageing"
              rows={data.ageing}
              columns={[
                { key: 'name', label: c.customer, kind: 'text' },
                { key: 'days0to30', label: c.days0to30, kind: 'money' },
                { key: 'days31to60', label: c.days31to60, kind: 'money' },
                { key: 'days61to90', label: c.days61to90, kind: 'money' },
                { key: 'over90', label: c.over90, kind: 'money' },
                { key: 'totalCents', label: c.total, kind: 'money' },
              ]}
            />
          </TabsContent>

          <TabsContent value="stock" className="grid gap-4">
            <ReportTable
              title={t.tabs.stock}
              file="stock-value"
              rows={data.stock}
              columns={[
                { key: 'fabricName', label: c.fabric, kind: 'text' },
                { key: 'remainingCm', label: c.left, kind: 'meters' },
                { key: 'costCents', label: c.atCost, kind: 'money' },
                { key: 'marketCents', label: c.atReference, kind: 'money' },
              ]}
            />
          </TabsContent>

          <TabsContent value="cash" className="grid gap-4">
            <MoneyBars
              title={t.charts.balance}
              label={c.balance}
              data={data.cash.map((row) => ({
                name: monthName(row.month),
                cents: row.balanceCents,
              }))}
            />
            <ReportTable
              title={t.tabs.cash}
              file="cash-flow"
              rows={data.cash}
              columns={[
                { key: 'month', label: c.month, kind: 'month' },
                { key: 'inCents', label: c.moneyIn, kind: 'money' },
                { key: 'outCents', label: c.moneyOut, kind: 'money' },
                { key: 'capitalCents', label: c.capital, kind: 'money' },
                { key: 'countsCents', label: c.counts, kind: 'money' },
                { key: 'netCents', label: c.net, kind: 'money' },
                { key: 'balanceCents', label: c.balance, kind: 'money' },
              ]}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
