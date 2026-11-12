'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { messages } from '@/i18n';
import { DateText, Money } from '@/shared/format';
import { Button } from '@/shared/ui/button';
import { ActivityTimeline } from './activity-timeline';
import { InvoiceStatusBadge } from './customer-parts';
import type { ActivityEvent, InvoiceRow, PaymentRow } from './customer-view';

const t = messages.customers;
const PREVIEW = 5;

function Section({
  title,
  onSeeAll,
  children,
}: {
  title: string;
  onSeeAll?: () => void;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="grid content-start gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-heading font-semibold">{title}</h3>
        {onSeeAll && (
          <Button variant="link" size="sm" onClick={onSeeAll}>
            {t.seeAll}
          </Button>
        )}
      </div>
      {children}
    </section>
  );
}

const Quiet = ({ children }: { children: ReactNode }) => (
  <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
    {children}
  </p>
);

/**
 * The profile at a glance: what is waiting to be collected (and a way to collect it), the latest
 * payments and the latest events. Each section's full list is a tab away.
 */
export function CustomerOverview({
  unpaid,
  payments,
  events,
  invoiceDates,
  onPay,
  onSeeInvoices,
  onSeePayments,
  onSeeActivity,
}: {
  /** The invoices with something left to collect, oldest first. */
  unpaid: readonly InvoiceRow[];
  payments: readonly PaymentRow[];
  events: readonly ActivityEvent[];
  invoiceDates: ReadonlyMap<string, string>;
  onPay: (saleId: string) => void;
  onSeeInvoices: () => void;
  onSeePayments: () => void;
  onSeeActivity: () => void;
}) {
  return (
    <div className="grid items-start gap-x-6 gap-y-5 lg:grid-cols-2">
      <Section
        title={t.outstandingInvoices}
        onSeeAll={unpaid.length > 0 ? onSeeInvoices : undefined}
      >
        {unpaid.length === 0 ? (
          <Quiet>{t.nothingOutstanding}</Quiet>
        ) : (
          <ul className="divide-y rounded-lg border bg-card">
            {unpaid.slice(0, PREVIEW).map((row) => (
              <li key={row.sale.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <Link
                    href={`/pos/view?id=${row.sale.id}`}
                    className="inline-flex min-h-6 w-fit items-center font-medium underline-offset-4 hover:underline pointer-coarse:min-h-11"
                  >
                    {t.invoiceOf} <DateText value={row.sale.date} />
                  </Link>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <InvoiceStatusBadge status={row.status} />
                    {row.sale.dueDate && (
                      <span>
                        {t.dueOn} <DateText value={row.sale.dueDate} />
                      </span>
                    )}
                  </span>
                </div>
                <Money cents={row.invoice?.dueCents ?? 0} tone="debt" className="font-semibold" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onPay(row.sale.id);
                  }}
                >
                  {t.payInvoice}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid gap-5">
        <Section
          title={t.recentPayments}
          onSeeAll={payments.length > 0 ? onSeePayments : undefined}
        >
          {payments.length === 0 ? (
            <Quiet>{t.noPayments}</Quiet>
          ) : (
            <ul className="divide-y rounded-lg border bg-card">
              {payments.slice(0, PREVIEW).map(({ payment }) => (
                <li key={payment.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="grid min-w-0 flex-1">
                    <span className="font-medium">{t.kinds[payment.kind]}</span>
                    <span className="text-xs text-muted-foreground">
                      <DateText value={payment.date} /> · {t.methods[payment.method]}
                    </span>
                  </div>
                  <Money
                    cents={payment.amountCents}
                    tone={payment.kind === 'payment' ? 'profit' : undefined}
                  />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={t.recentActivity} onSeeAll={events.length > 0 ? onSeeActivity : undefined}>
          {events.length === 0 ? (
            <Quiet>{t.activity.empty}</Quiet>
          ) : (
            <ActivityTimeline events={events.slice(0, PREVIEW)} invoiceDates={invoiceDates} />
          )}
        </Section>
      </div>
    </div>
  );
}
