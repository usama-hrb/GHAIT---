import {
  BanIcon,
  BanknoteIcon,
  HandCoinsIcon,
  Undo2Icon,
  ReceiptTextIcon,
  type LucideIcon,
  CircleSlashIcon,
} from 'lucide-react';
import Link from 'next/link';
import { messages } from '@/i18n';
import { DateText, Money } from '@/shared/format';
import type { ActivityEvent } from './customer-view';

const t = messages.customers;

const ICON: Record<ActivityEvent['kind'], LucideIcon> = {
  purchase: ReceiptTextIcon,
  payment: BanknoteIcon,
  refund: HandCoinsIcon,
  return: Undo2Icon,
  voided: BanIcon,
  writeOff: CircleSlashIcon,
};

/** The invoice an event is about, as a link, by the date it carries. */
function InvoiceLink({ saleId, dates }: { saleId: string; dates: ReadonlyMap<string, string> }) {
  const date = dates.get(saleId);
  return (
    <Link href={`/pos/view?id=${saleId}`} className="underline-offset-4 hover:underline">
      {t.invoiceOf} {date ? <DateText value={date} /> : null}
    </Link>
  );
}

/** What an event adds: the amount, the invoice, the reason or the note. */
function Detail({ event, dates }: { event: ActivityEvent; dates: ReadonlyMap<string, string> }) {
  switch (event.kind) {
    case 'purchase':
      return (
        <>
          <InvoiceLink saleId={event.saleId} dates={dates} /> · <Money cents={event.amountCents} />
        </>
      );
    case 'payment':
    case 'refund':
      return (
        <>
          <Money cents={event.amountCents} /> · {t.methods[event.method]}
          {event.note ? ` · ${event.note}` : ''}
        </>
      );
    case 'return':
      return (
        <>
          <InvoiceLink saleId={event.saleId} dates={dates} /> · <Money cents={event.amountCents} />
        </>
      );
    case 'voided':
      return <InvoiceLink saleId={event.saleId} dates={dates} />;
    case 'writeOff':
      return (
        <>
          <InvoiceLink saleId={event.saleId} dates={dates} /> · {event.reason}
        </>
      );
  }
}

/** The account's history, newest first, one line per event. */
export function ActivityTimeline({
  events,
  invoiceDates,
}: {
  events: readonly ActivityEvent[];
  /** The date of each invoice, by sale id (to name the invoice an event is about). */
  invoiceDates: ReadonlyMap<string, string>;
}) {
  return (
    <ol className="divide-y rounded-lg border bg-card">
      {events.map((event) => {
        const Icon = ICON[event.kind];
        return (
          <li key={event.id} className="flex items-start gap-3 px-3 py-2.5">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Icon className="size-4" aria-hidden />
            </span>
            <div className="grid min-w-0 flex-1 gap-0.5">
              <p className="font-medium">{t.activity[event.kind]}</p>
              <p className="text-sm break-words text-muted-foreground">
                <Detail event={event} dates={invoiceDates} />
              </p>
            </div>
            <DateText value={event.date} className="shrink-0 text-xs text-muted-foreground" />
          </li>
        );
      })}
    </ol>
  );
}
