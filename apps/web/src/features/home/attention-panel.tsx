'use client';

import {
  CalendarClockIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  HandCoinsIcon,
  type LucideIcon,
  PackageMinusIcon,
  PackageXIcon,
  ReceiptIcon,
  RefreshCwOffIcon,
  RulerIcon,
  ScaleIcon,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { messages } from '@/i18n';
import { Money } from '@/shared/format';
import { Badge } from '@/shared/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';
import type { AttentionId, AttentionItem, Severity } from './attention';

const t = messages.home.attention;

const ICON: Record<AttentionId, LucideIcon> = {
  out_of_stock: PackageXIcon,
  low_stock: PackageMinusIcon,
  awaiting: RulerIcon,
  overdue_debts: HandCoinsIcon,
  unpaid_bills: ReceiptIcon,
  bills_late: CalendarClockIcon,
  bills_due: CalendarClockIcon,
  zakat: ScaleIcon,
  sync_issues: RefreshCwOffIcon,
};

/** The sentence for an item, in the language shown now. */
function titleOf(item: AttentionItem): string {
  switch (item.id) {
    case 'out_of_stock':
      return t.outOfStock(item.count);
    case 'low_stock':
      return t.lowStock(item.count);
    case 'awaiting':
      return t.awaiting(item.count);
    case 'overdue_debts':
      return t.overdueDebts(item.count);
    case 'unpaid_bills':
      return t.unpaidBills(item.count);
    case 'bills_late':
      return t.billsLate(item.count);
    case 'bills_due':
      return t.billsDue(item.count);
    case 'sync_issues':
      return t.syncIssues(item.count);
    case 'zakat':
      return item.zakat?.kind === 'upcoming'
        ? messages.zakat.reminderUpcoming(item.zakat.days)
        : messages.zakat.reminderDue;
  }
}

/** The line under it: the first names, or what the amount comes to. */
function detailOf(item: AttentionItem): ReactNode {
  if (item.cents !== null) return <Money cents={item.cents} tone="debt" />;
  if (item.names.length > 0) {
    // Names as typed: each isolated, so an Arabic name never reorders an English line.
    return item.names.flatMap((name, index) => [
      ...(index > 0 ? [messages.home.listSeparator] : []),
      <bdi key={name}>{name}</bdi>,
    ]);
  }
  return null;
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const Icon = ICON[item.id];
  const detail = detailOf(item);
  return (
    <li>
      <Link
        href={item.href}
        className="group/row flex items-center gap-3 rounded-lg px-2 py-2.5 outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:py-3.5"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
          <Icon className="size-4.5" aria-hidden />
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="font-medium text-balance">{titleOf(item)}</span>
          {detail !== null && (
            <span className="truncate text-xs text-muted-foreground">{detail}</span>
          )}
        </span>
        <ChevronRightIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground rtl:rotate-180"
        />
      </Link>
    </li>
  );
}

const GROUPS: readonly {
  severity: Severity;
  badge: 'destructive' | 'warning';
  label: () => string;
}[] = [
  { severity: 'urgent', badge: 'destructive', label: () => t.urgent },
  { severity: 'soon', badge: 'warning', label: () => t.soon },
];

/**
 * Only what needs doing, most severe first, in two groups (urgent, soon), each row opening the
 * page that fixes it (filtered where the page can be). Nothing to do is one calm line, not a
 * grid of empty cards. `items` undefined: still being read.
 */
export function AttentionPanel({ items }: { items: AttentionItem[] | undefined }) {
  return (
    <Card size="sm" className="min-w-0" role="region" aria-label={t.title}>
      <CardHeader>
        <CardTitle className="font-heading text-base">{t.title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items === undefined ? (
          <div className="grid gap-2" aria-hidden>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : items.length === 0 ? (
          <p className="flex items-center gap-2 py-2 text-muted-foreground">
            <CircleCheckIcon className="size-5 text-success" aria-hidden />
            {t.allClear}
          </p>
        ) : (
          <div className="grid gap-3">
            {GROUPS.map((group) => {
              const rows = items.filter((item) => item.severity === group.severity);
              if (rows.length === 0) return null;
              return (
                <section key={group.severity} aria-label={group.label()} className="grid gap-1">
                  <Badge variant={group.badge} className="justify-self-start">
                    {group.label()}
                  </Badge>
                  <ul className="grid">
                    {rows.map((item) => (
                      <AttentionRow key={item.id} item={item} />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
