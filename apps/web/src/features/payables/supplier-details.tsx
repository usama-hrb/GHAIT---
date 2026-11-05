'use client';

import { PencilIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { messages } from '@/i18n';
import type { SupplierAccountView } from '@/local-db';
import { DateText } from '@/shared/format';
import { Button } from '@/shared/ui/button';

const t = messages.payables;

/** What is on file for the supplier, with a way to correct it (the owner's). */
export function SupplierDetails({
  view,
  canEdit,
  onEdit,
}: {
  view: SupplierAccountView;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const { supplier, lastActivity } = view;
  const none = <span className="text-muted-foreground">{t.details.none}</span>;
  return (
    <section aria-label={t.details.title} className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-heading font-semibold">{t.details.title}</h3>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={onEdit}>
            <PencilIcon aria-hidden />
            {t.editSupplier}
          </Button>
        )}
      </div>
      <dl className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2">
        <Row label={t.name}>{supplier.name}</Row>
        <Row label={t.phone}>
          {supplier.phone ? (
            <bdi dir="ltr" data-num>
              {supplier.phone}
            </bdi>
          ) : (
            none
          )}
        </Row>
        <Row label={t.since}>
          <DateText value={supplier.createdAt} />
        </Row>
        <Row label={t.lastActivity}>{lastActivity ? <DateText value={lastActivity} /> : none}</Row>
        <Row label={t.details.purchaseCount}>
          <span data-num>{view.purchases.length}</span>
        </Row>
        <Row label={t.details.paymentCount}>
          <span data-num>
            {view.payments.filter((payment) => payment.voidedAt === null).length}
          </span>
        </Row>
        <Row label={t.notes} wide>
          {supplier.notes ? <span className="whitespace-pre-wrap">{supplier.notes}</span> : none}
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
