'use client';

import { PencilIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { messages } from '@/i18n';
import type { CustomerAccountView, CustomerSummary } from '@/local-db';
import { DateText } from '@/shared/format';
import { Button } from '@/shared/ui/button';

const t = messages.customers;

/** What is on file for the customer, with a way to correct it. */
export function CustomerDetails({
  view,
  lastActivity,
  onEdit,
}: {
  view: CustomerAccountView;
  lastActivity: CustomerSummary['lastActivity'];
  onEdit: () => void;
}) {
  const { customer } = view;
  const none = <span className="text-muted-foreground">{t.details.none}</span>;
  return (
    <section aria-label={t.details.title} className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-heading font-semibold">{t.details.title}</h3>
        <Button variant="outline" size="sm" onClick={onEdit}>
          <PencilIcon aria-hidden />
          {t.editCustomer}
        </Button>
      </div>
      <dl className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2">
        <Row label={t.name}>{customer.name}</Row>
        <Row label={t.phone}>
          {customer.phone ? (
            <bdi dir="ltr" data-num>
              {customer.phone}
            </bdi>
          ) : (
            none
          )}
        </Row>
        <Row label={t.since}>
          <DateText value={customer.createdAt} />
        </Row>
        <Row label={t.lastActivity}>{lastActivity ? <DateText value={lastActivity} /> : none}</Row>
        <Row label={t.details.invoiceCount}>
          <span data-num>{view.sales.filter((sale) => sale.voidedAt === null).length}</span>
        </Row>
        <Row label={t.details.paymentCount}>
          <span data-num>{view.payments.length}</span>
        </Row>
        <Row label={t.notes} wide>
          {customer.notes ? <span className="whitespace-pre-wrap">{customer.notes}</span> : none}
        </Row>
      </dl>
    </section>
  );
}

function Row({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`grid gap-0.5 bg-card px-3 py-2.5 ${wide ? 'sm:col-span-2' : ''}`}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
