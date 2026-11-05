'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { messages } from '@/i18n';
import { DateText, Money } from '@/shared/format';
import { Button } from '@/shared/ui/button';
import { ActivityTimeline } from './activity-timeline';
import { PurchaseStatusBadge } from './supplier-parts';
import type { ActivityEvent, PaymentRow, PurchaseRow } from './supplier-view';

const t = messages.payables;
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
 * The profile at a glance: the purchases still to be paid (and a way to pay each), the latest
 * payments and the latest events. Each section's full list is a tab away.
 */
export function SupplierOverview({
  unpaid,
  payments,
  events,
  canPay,
  onPay,
  onSeePurchases,
  onSeePayments,
  onSeeActivity,
}: {
  /** The purchases with something left to pay, oldest first. */
  unpaid: readonly PurchaseRow[];
  payments: readonly PaymentRow[];
  events: readonly ActivityEvent[];
  canPay: boolean;
  onPay: (purchaseId: string) => void;
  onSeePurchases: () => void;
  onSeePayments: () => void;
  onSeeActivity: () => void;
}) {
  return (
    <div className="grid items-start gap-x-6 gap-y-5 lg:grid-cols-2">
      <Section
        title={t.awaitingPayment}
        onSeeAll={unpaid.length > PREVIEW ? onSeePurchases : undefined}
      >
        {unpaid.length === 0 ? (
          <Quiet>{t.nothingOwed}</Quiet>
        ) : (
          <ul className="divide-y rounded-lg border bg-card">
            {unpaid.slice(0, PREVIEW).map((row) => {
              const { purchase, productNames } = row.record;
              return (
                <li key={purchase.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <Link
                      href={`/purchases/view?id=${purchase.id}`}
                      className="w-fit font-medium underline-offset-4 hover:underline"
                    >
                      {t.purchaseOf} <DateText value={purchase.date} />
                    </Link>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <PurchaseStatusBadge status={row.status} />
                      {productNames.length > 0 && (
                        <span className="truncate">{productNames.join('، ')}</span>
                      )}
                    </span>
                  </div>
                  <Money cents={row.due?.dueCents ?? 0} tone="debt" className="font-semibold" />
                  {canPay && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        onPay(purchase.id);
                      }}
                    >
                      {t.payPurchase}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <div className="grid gap-5">
        <Section
          title={t.recentPayments}
          onSeeAll={payments.length > PREVIEW ? onSeePayments : undefined}
        >
          {payments.length === 0 ? (
            <Quiet>{t.noPayments}</Quiet>
          ) : (
            <ul className="divide-y rounded-lg border bg-card">
              {payments.slice(0, PREVIEW).map(({ payment }) => (
                <li key={payment.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="grid min-w-0 flex-1">
                    <span className="font-medium">
                      <DateText value={payment.date} />
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t.methods[payment.method]}
                      {payment.voidedAt !== null && ` · ${t.voided}`}
                    </span>
                  </div>
                  <Money
                    cents={payment.amountCents}
                    tone={payment.voidedAt === null ? 'profit' : undefined}
                    className={payment.voidedAt === null ? undefined : 'line-through'}
                  />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title={t.recentActivity}
          onSeeAll={events.length > PREVIEW ? onSeeActivity : undefined}
        >
          {events.length === 0 ? (
            <Quiet>{t.activity.empty}</Quiet>
          ) : (
            <ActivityTimeline events={events.slice(0, PREVIEW)} />
          )}
        </Section>
      </div>
    </div>
  );
}
