import { BanIcon, BanknoteIcon, PackageIcon, type LucideIcon, UserPlusIcon } from 'lucide-react';
import Link from 'next/link';
import { messages } from '@/i18n';
import { DateText, Money } from '@/shared/format';
import type { ActivityEvent } from './supplier-view';

const t = messages.payables;

const ICON: Record<ActivityEvent['kind'], LucideIcon> = {
  purchase: PackageIcon,
  payment: BanknoteIcon,
  paymentVoided: BanIcon,
  added: UserPlusIcon,
};

/** What an event adds: its amount, what was bought or how it was paid, and the note. */
function Detail({ event }: { event: ActivityEvent }) {
  switch (event.kind) {
    case 'purchase':
      return (
        <>
          <Link
            href={`/purchases/view?id=${event.purchaseId}`}
            className="underline-offset-4 hover:underline"
          >
            {event.productNames.length > 0 ? event.productNames.join('، ') : t.purchaseOf}
          </Link>{' '}
          · <Money cents={event.amountCents} />
          {event.paidAtPurchaseCents > 0 && (
            <>
              {' '}
              · {t.activity.paidAtPurchase} <Money cents={event.paidAtPurchaseCents} />
            </>
          )}
        </>
      );
    case 'payment':
      return (
        <>
          <Money cents={event.amountCents} /> · {t.methods[event.method]}
          {event.note ? ` · ${event.note}` : ''}
        </>
      );
    case 'paymentVoided':
      return <Money cents={event.amountCents} />;
    case 'added':
      return null;
  }
}

/**
 * The account's history, newest first, one entry per event. A purchase and a payment say what the
 * shop owed after them: the statement's own running balance.
 */
export function ActivityTimeline({ events }: { events: readonly ActivityEvent[] }) {
  return (
    <ol className="divide-y rounded-lg border bg-card">
      {events.map((event) => {
        const Icon = ICON[event.kind];
        const balance =
          event.kind === 'purchase' || event.kind === 'payment' ? event.balanceCents : null;
        return (
          <li key={event.id} className="flex items-start gap-3 px-3 py-2.5">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Icon className="size-4" aria-hidden />
            </span>
            <div className="grid min-w-0 flex-1 gap-0.5">
              <p className="font-medium">{t.activity[event.kind]}</p>
              <p className="text-sm break-words text-muted-foreground">
                <Detail event={event} />
              </p>
              {balance !== null && (
                <p className="text-xs text-muted-foreground">
                  {t.activity.balanceAfter}: <Money cents={balance} />
                </p>
              )}
            </div>
            <DateText value={event.date} className="shrink-0 text-xs text-muted-foreground" />
          </li>
        );
      })}
    </ol>
  );
}
