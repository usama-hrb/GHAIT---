import type { ZakatReviewItem, ZakatReviewKey, ZakatReviewSeverity } from '@fabric/contracts';
import { InfoIcon, type LucideIcon, OctagonAlertIcon, TriangleAlertIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { messages } from '@/i18n';
import { DateText, Money } from '@/shared/format';
import { cn } from '@/shared/lib/utils';

const SEVERITY: Record<ZakatReviewSeverity, { icon: LucideIcon; edge: string; badge: string }> = {
  blocking: {
    icon: OctagonAlertIcon,
    edge: 'border-s-destructive',
    badge: 'bg-destructive/10 text-destructive',
  },
  review: {
    icon: TriangleAlertIcon,
    edge: 'border-s-warning',
    badge: 'bg-warning/10 text-warning',
  },
  info: { icon: InfoIcon, edge: 'border-s-info', badge: 'bg-info/10 text-info' },
};

/** What an item's count counts, where it has one. */
const COUNT_NOUN: Partial<Record<ZakatReviewKey, 'batches' | 'customers' | 'daysAgo'>> = {
  goods_without_price: 'batches',
  goods_unmeasured_at_cost: 'batches',
  doubtful_debts: 'customers',
  position_not_on_hawl_day: 'daysAgo',
};

type Figure =
  | { name: 'count'; text: string }
  | { name: 'cents'; cents: number }
  | { name: 'date'; date: string };

/** The numbers an item is about: how many, how much and which day, in that order. */
function figuresOf(item: ZakatReviewItem): Figure[] {
  const t = messages.zakat;
  const figures: Figure[] = [];
  const noun = COUNT_NOUN[item.key];
  if (item.count !== undefined && noun !== undefined)
    figures.push({ name: 'count', text: t.counts[noun](item.count) });
  if (item.cents !== undefined) figures.push({ name: 'cents', cents: item.cents });
  if (item.date !== undefined) figures.push({ name: 'date', date: item.date });
  return figures;
}

function FigureView({ figure }: { figure: Figure }): ReactNode {
  switch (figure.name) {
    case 'count':
      return figure.text;
    case 'cents':
      return <Money cents={figure.cents} tone={figure.cents < 0 ? 'loss' : undefined} />;
    case 'date':
      return <DateText value={figure.date} />;
  }
}

function ReviewItemRow({ item }: { item: ZakatReviewItem }) {
  const t = messages.zakat;
  const tone = SEVERITY[item.severity];
  const Icon = tone.icon;
  const copy = t.items[item.key];
  const figures = figuresOf(item);
  return (
    <div
      className={cn('flex items-start gap-3 rounded-lg border border-s-4 bg-card p-3', tone.edge)}
    >
      <span
        className={cn('flex size-8 shrink-0 items-center justify-center rounded-full', tone.badge)}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="grid min-w-0 gap-1">
        <p className="text-xs font-medium text-muted-foreground">{t.severity[item.severity]}</p>
        <p className="font-medium">{copy.title}</p>
        <p className="text-sm text-muted-foreground">{copy.detail}</p>
        {figures.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-2 text-sm">
            {figures.map((figure, index) => (
              <span key={figure.name} className="flex items-center gap-x-2">
                {index > 0 && <span aria-hidden>·</span>}
                <FigureView figure={figure} />
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The items a calculation asks a person to look at, each with what it is about: a word for how
 * serious it is (backed by an icon and an edge colour), what it means and its numbers. It reads
 * what `zakatReviewOf` found and decides nothing.
 */
export function ReviewItemList({
  items,
  className,
}: {
  items: readonly ZakatReviewItem[];
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <ul className={cn('grid gap-2', className)}>
      {items.map((item) => (
        <li key={item.key}>
          <ReviewItemRow item={item} />
        </li>
      ))}
    </ul>
  );
}
