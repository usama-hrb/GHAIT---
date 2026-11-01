'use client';

import { formatMoneyAmount } from '@fabric/core';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { moneyUnitLabel, useMoneyUnit } from '@/shared/format';
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/shared/ui/chart';
import { useDirection } from '@/shared/ui/direction';

/**
 * One measure as bars (one series: the brand's chart tokens do not pass as a categorical
 * palette, so reports never compare series by colour). The first item and the values sit at the
 * start of the reading direction (right in Arabic, left in English). The table beside it holds
 * every number.
 */
export function MoneyBars({
  title,
  data,
  label,
  layout = 'vertical-bars',
}: {
  title: string;
  data: readonly { name: string; cents: number }[];
  /** The measure's name, for the tooltip. */
  label: string;
  /** Horizontal bars for categories with long names. */
  layout?: 'vertical-bars' | 'horizontal-bars';
}) {
  const { unit } = useMoneyUnit();
  const rtl = useDirection() === 'rtl';
  const config = { cents: { label, color: 'var(--chart-1)' } } satisfies ChartConfig;
  const money = (value: unknown) =>
    typeof value === 'number' ? `${formatMoneyAmount(value, unit)} ${moneyUnitLabel(unit)}` : '';
  const tick = (value: unknown) =>
    typeof value === 'number' ? formatMoneyAmount(value, unit) : '';
  const horizontal = layout === 'horizontal-bars';
  return (
    <figure className="rounded-xl border bg-card p-4">
      <figcaption className="mb-2 font-semibold">{title}</figcaption>
      <ChartContainer config={config} className="h-64 w-full">
        <BarChart
          data={[...data]}
          layout={horizontal ? 'vertical' : 'horizontal'}
          accessibilityLayer
        >
          <CartesianGrid vertical={horizontal} horizontal={!horizontal} />
          {horizontal ? (
            <>
              <XAxis
                type="number"
                tickLine={false}
                axisLine={false}
                tickFormatter={tick}
                reversed={rtl}
              />
              <YAxis
                type="category"
                dataKey="name"
                orientation={rtl ? 'right' : 'left'}
                tickLine={false}
                axisLine={false}
                width={96}
              />
            </>
          ) : (
            <>
              <XAxis dataKey="name" tickLine={false} axisLine={false} reversed={rtl} />
              <YAxis
                orientation={rtl ? 'right' : 'left'}
                tickLine={false}
                axisLine={false}
                width={64}
                tickFormatter={tick}
              />
            </>
          )}
          <ChartTooltip content={<ChartTooltipContent formatter={(value) => money(value)} />} />
          <Bar dataKey="cents" fill="var(--color-cents)" radius={4} />
        </BarChart>
      </ChartContainer>
    </figure>
  );
}
