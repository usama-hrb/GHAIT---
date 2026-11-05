'use client';

import {
  BanknoteArrowDownIcon,
  BanknoteArrowUpIcon,
  ChevronRightIcon,
  type LucideIcon,
  PackagePlusIcon,
  ReceiptIcon,
  ShoppingCartIcon,
  SlidersHorizontalIcon,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { categoryName } from '@/features/expenses';
import { messages } from '@/i18n';
import type { ActivityEvent, ActivityKind } from '@/local-db';
import { DateText, Money, Quantity } from '@/shared/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';

const t = messages.home.activity;

const ICON: Record<ActivityKind, LucideIcon> = {
  sale: ShoppingCartIcon,
  purchase: PackagePlusIcon,
  customer_payment: BanknoteArrowDownIcon,
  supplier_payment: BanknoteArrowUpIcon,
  expense: ReceiptIcon,
  stock_adjustment: SlidersHorizontalIcon,
};

/** Money that came in is "+", money that went out is "−": the direction is in the figure, not a colour. */
const MONEY_SIGN: Partial<Record<ActivityKind, '+' | '−'>> = {
  sale: '+',
  customer_payment: '+',
  supplier_payment: '−',
  expense: '−',
};

function titleOf(event: ActivityEvent): string {
  return event.kind === 'stock_adjustment' && event.adjustment
    ? t.kinds[event.adjustment]
    : t.kinds[event.kind === 'stock_adjustment' ? 'adjustment' : event.kind];
}

/** What it was about, as typed (a name, a note) and so isolated from the language around it. */
function detailOf(event: ActivityEvent): ReactNode[] {
  const parts: ReactNode[] = [];
  if (event.category) parts.push(<bdi key="category">{categoryName(event.category)}</bdi>);
  if (event.subject) parts.push(<bdi key="subject">{event.subject}</bdi>);
  if (event.more > 0) parts.push(<span key="more">{t.andOthers(event.more)}</span>);
  return parts.flatMap((part, index) => (index === 0 ? [part] : [' · ', part]));
}

function Amount({ event }: { event: ActivityEvent }) {
  if (event.amountCents !== null) {
    const sign = MONEY_SIGN[event.kind];
    return (
      <span className="font-medium">
        {sign && <span data-num>{sign}</span>}
        <Money cents={event.amountCents} />
      </span>
    );
  }
  if (event.quantity) {
    const { unit, amount } = event.quantity;
    return (
      <span className="font-medium">
        <span data-num>{amount < 0 ? '−' : '+'}</span>
        <Quantity unit={unit} amount={Math.abs(amount)} />
      </span>
    );
  }
  return null;
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const Icon = ICON[event.kind];
  const detail = detailOf(event);
  return (
    <li>
      <Link
        href={event.href}
        className="flex items-center gap-3 rounded-lg px-2 py-2 outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:py-3"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate font-medium">{titleOf(event)}</span>
          <span className="truncate text-xs text-muted-foreground">
            {detail.length > 0 && (
              <>
                {detail}
                <span aria-hidden> · </span>
              </>
            )}
            <DateText value={event.at} format="dayMonth" />{' '}
            <DateText value={event.at} format="time" />
          </span>
        </span>
        <span className="shrink-0 text-end text-sm">
          <Amount event={event} />
        </span>
        <ChevronRightIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground rtl:rotate-180"
        />
      </Link>
    </li>
  );
}

/**
 * The newest events of the shop in one compact list: what happened, about whom or what, when, how
 * much, and a link to the record. `events` undefined: still being read.
 */
export function ActivityPanel({ events }: { events: ActivityEvent[] | undefined }) {
  return (
    <Card size="sm" className="min-w-0" role="region" aria-label={t.title}>
      <CardHeader>
        <CardTitle className="font-heading text-base">{t.title}</CardTitle>
      </CardHeader>
      <CardContent>
        {events === undefined ? (
          <div className="grid gap-2" aria-hidden>
            {Array.from({ length: 5 }, (_, row) => (
              <Skeleton key={row} className="h-11 w-full" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <p className="py-4 text-center text-muted-foreground">{t.empty}</p>
        ) : (
          <ul className="grid">
            {events.map((event) => (
              <ActivityRow key={event.id} event={event} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
