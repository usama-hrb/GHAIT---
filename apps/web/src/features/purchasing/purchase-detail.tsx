'use client';

import { mayPush } from '@fabric/contracts';
import { costPerMeterCents } from '@fabric/core';
import { PencilIcon } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories, useSession } from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice } from '@/shared/brand';
import { DateText, Kilograms, Money, Quantity } from '@/shared/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { PurchasePaymentDialog } from './purchase-payment-dialog';

const t = messages.purchasing;

/**
 * One purchase and the batches it brought in, with their codes (/purchases/view?id=…). Purchases
 * made before product batches show the same way: each roll became a batch with its id.
 */
export function PurchaseDetailScreen() {
  const id = useSearchParams().get('id') ?? '';
  const repositories = useRepositories();
  const { user } = useSession();
  // What was paid is the owner's to correct (SP9); a partner reads it.
  const canEditPayment = user !== null && mayPush(user.role, 'purchase', 'upsert');
  const [editing, setEditing] = useState(false);
  const data = useLiveQuery(async () => {
    const purchase = await repositories.purchases.get(id);
    if (!purchase) return null;
    const batches = await repositories.purchases.batchesOf(id);
    const [products, views] = await Promise.all([
      Promise.all(batches.map((batch) => repositories.products.get(batch.productId))),
      Promise.all(batches.map((batch) => repositories.stock.view(batch.id))),
    ]);
    const supplier = purchase.supplierId
      ? await repositories.suppliers.get(purchase.supplierId)
      : undefined;
    // What is still due on the purchase is the supplier account's (payments made since count).
    const account = purchase.supplierId
      ? (await repositories.supplierAccounts.account(purchase.supplierId))?.account
      : undefined;
    const dueCents = account?.purchases.find((due) => due.purchaseId === id)?.dueCents;
    return { purchase, batches, products, views, supplier, dueCents };
  }, [repositories, id]);

  if (data === undefined) return <LoadingState />;
  const back = (
    <Button asChild variant="link" className="justify-self-start px-0">
      <Link href="/inventory">{messages.productStock.detail.back}</Link>
    </Button>
  );
  if (data === null) return <EmptyState title={t.notFound} action={back} />;
  const { purchase, batches, products, views, supplier, dueCents } = data;
  const owedCents = dueCents ?? purchase.totalCostCents - purchase.paidCents;

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <OfflineNotice />
      {back}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-heading text-xl font-semibold">{products[0]?.name ?? t.detailTitle}</h2>
        <Badge variant="secondary">{t.methods[purchase.method]}</Badge>
      </div>
      <dl className="grid gap-x-6 gap-y-2 rounded-lg border bg-card p-4 sm:grid-cols-2">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{t.fields.date}</dt>
          <dd>
            <DateText value={purchase.date} format="long" />
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{t.fields.supplier}</dt>
          <dd>
            {supplier ? (
              <Link
                href={`/payables/view?id=${supplier.id}`}
                className="underline-offset-4 hover:underline"
              >
                {supplier.name}
              </Link>
            ) : (
              t.fields.supplierPlaceholder
            )}
          </dd>
        </div>
        {purchase.pricePerMeterCents !== null && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t.fields.pricePerMeter}</dt>
            <dd>
              <Money cents={purchase.pricePerMeterCents} />
            </dd>
          </div>
        )}
        {purchase.weightG !== null && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t.fields.weight}</dt>
            <dd>
              <Kilograms grams={purchase.weightG} />
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{t.total}</dt>
          <dd className="font-semibold">
            <Money cents={purchase.totalCostCents} />
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">{t.paid}</dt>
          <dd className="flex items-center gap-2">
            <Money cents={purchase.paidCents} />
            {canEditPayment && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(true);
                }}
              >
                <PencilIcon data-icon="inline-start" aria-hidden />
                {t.payment.edit}
              </Button>
            )}
          </dd>
        </div>
        {owedCents > 0 && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t.owed}</dt>
            <dd>
              <Money cents={owedCents} tone="debt" />
            </dd>
          </div>
        )}
      </dl>
      {purchase.notes && <p className="text-muted-foreground">{purchase.notes}</p>}

      <div className="rounded-lg border bg-card">
        <Table stack>
          <TableHeader>
            <TableRow>
              <TableHead>{t.code}</TableHead>
              <TableHead>{t.fields.product}</TableHead>
              <TableHead className="text-end">{t.received}</TableHead>
              <TableHead className="text-end">{t.cost}</TableHead>
              <TableHead className="text-end">{t.costPerMeter}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.map((batch, index) => {
              const status = views[index]?.ledger.measurementStatus;
              const lengthCm =
                batch.unit === 'meter'
                  ? batch.receivedQuantity
                  : (batch.conversion?.lengthCm ?? null);
              return (
                <TableRow key={batch.id} className="sm:h-12">
                  <TableCell>
                    <bdi dir="ltr" data-num className="font-medium">
                      {batch.code}
                    </bdi>
                  </TableCell>
                  <TableCell label={t.fields.product}>{products[index]?.name}</TableCell>
                  <TableCell className="text-end" label={t.received}>
                    <Quantity unit={batch.unit} amount={batch.receivedQuantity} />
                    {status === 'estimated' && (
                      <Badge variant="warning" className="ms-1.5">
                        {t.estimated}
                      </Badge>
                    )}
                    {status === 'pending' && (
                      <Badge variant="secondary" className="ms-1.5">
                        {messages.productStock.status.awaiting}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-end" label={t.cost}>
                    <Money cents={batch.costTotalCents} />
                  </TableCell>
                  <TableCell className="text-end" label={t.costPerMeter}>
                    {lengthCm === null ? (
                      '—'
                    ) : (
                      <Money cents={costPerMeterCents(batch.costTotalCents, lengthCm)} />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {views.some((view) => view?.ledger.measurementStatus === 'estimated') && (
        <p className="text-sm text-muted-foreground">{t.estimatedHint}</p>
      )}
      {editing && (
        <PurchasePaymentDialog
          purchaseId={purchase.id}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(false);
          }}
        />
      )}
    </div>
  );
}
