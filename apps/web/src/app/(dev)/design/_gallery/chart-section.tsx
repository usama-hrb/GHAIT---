'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { designMessages as t } from '@/i18n/ar.design';
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/shared/ui/chart';
import { Section } from './section';

const SALES = [1850, 2400, 1600, 2950, 2100, 3400];
const PROFIT = [370, 520, 300, 610, 450, 720];
const DATA = t.chart.days.map((day, index) => ({
  day,
  sales: SALES[index] ?? 0,
  profit: PROFIT[index] ?? 0,
}));

const config = {
  sales: { label: t.chart.sales, color: 'var(--chart-1)' },
  profit: { label: t.chart.profit, color: 'var(--chart-2)' },
} satisfies ChartConfig;

export function ChartSection() {
  return (
    <Section id="chart" title={t.sections.chart}>
      <figure className="max-w-3xl rounded-xl border bg-card p-4">
        <figcaption className="mb-2 font-semibold">{t.chart.title}</figcaption>
        <ChartContainer config={config} className="h-72 w-full">
          <BarChart data={DATA} accessibilityLayer>
            <CartesianGrid vertical={false} />
            {/* RTL: first day on the right, values axis on the right. */}
            <XAxis dataKey="day" tickLine={false} axisLine={false} reversed />
            <YAxis orientation="right" tickLine={false} axisLine={false} width={48} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="sales" fill="var(--color-sales)" radius={4} />
            <Bar dataKey="profit" fill="var(--color-profit)" radius={4} />
          </BarChart>
        </ChartContainer>
      </figure>
    </Section>
  );
}
