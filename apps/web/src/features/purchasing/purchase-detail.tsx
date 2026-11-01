'use client';

import { costPerMeterCents } from '@fabric/core';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories } from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice } from '@/shared/brand';
import { DateText, Kilograms, Meters, Money } from '@/shared/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

const t = messages.purchasing;

/** One purchase and the rolls it created, with their codes (/purchases/view?id=…). */
export function PurchaseDetailScreen() {
  const id = useSearchParams().get('id') ?? '';
  const repositories = useRepositories();
  const data = useLiveQuery(async () => {
    const purchase = await repositories.purchases.get(id);
    if (!purchase) return null;
    const rolls = await repositories.purchases.rollsOf(id);
    const variants = await Promise.all(
      rolls.map((roll) => repositories.variants.get(roll.variantId)),
    );
    const fabric = variants[0] ? await repositories.fabrics.get(variants[0].fabricId) : undefined;
    const supplier = purchase.supplierId
      ? await repositories.suppliers.get(purchase.supplierId)
      : undefined;
    return { purchase, rolls, variants, fabric, supplier };
  }, [repositories, id]);

  if (data === undefined) return <LoadingState />;
  if (data === null) {
    return (
      <EmptyState
        title={t.notFound}
        action={
          <Button asChild variant="outline">
            <Link href="/purchases">{t.back}</Link>
          </Button>
        }
      />
    );
  }
  const { purchase, rolls, variants, fabric, supplier } = data;

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <OfflineNotice />
      <Button asChild variant="link" className="justify-self-start px-0">
        <Link href="/purchases">{t.back}</Link>
      </Button>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-heading text-xl font-semibold">{fabric?.name ?? t.detailTitle}</h2>
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
          <dd>{supplier?.name ?? t.fields.supplierPlaceholder}</dd>
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
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{t.paid}</dt>
          <dd>
            <Money cents={purchase.paidCents} />
          </dd>
        </div>
        {purchase.paidCents < purchase.totalCostCents && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t.owed}</dt>
            <dd>
              <Money cents={purchase.totalCostCents - purchase.paidCents} tone="debt" />
              {purchase.supplierId && (
                <Link
                  href={`/payables/view?id=${purchase.supplierId}`}
                  className="ms-2 text-sm underline-offset-4 hover:underline"
                >
                  {messages.payables.title}
                </Link>
              )}
            </dd>
          </div>
        )}
      </dl>
      {purchase.notes && <p className="text-muted-foreground">{purchase.notes}</p>}

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.code}</TableHead>
              <TableHead>{t.fields.color}</TableHead>
              <TableHead className="text-end">{t.length}</TableHead>
              <TableHead className="text-end">{t.cost}</TableHead>
              <TableHead className="text-end max-sm:hidden">{t.costPerMeter}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rolls.map((roll, index) => (
              <TableRow key={roll.id} className="h-12">
                <TableCell>
                  <bdi dir="ltr" data-num className="font-medium">
                    {roll.shortCode}
                  </bdi>
                </TableCell>
                <TableCell>{variants[index]?.colorName}</TableCell>
                <TableCell className="text-end">
                  <Meters cm={roll.lengthCmInitial} />
                  {roll.lengthEstimated && (
                    <Badge variant="warning" className="ms-1.5">
                      {t.estimated}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-end">
                  <Money cents={roll.costTotalCents} />
                </TableCell>
                <TableCell className="text-end max-sm:hidden">
                  <Money cents={costPerMeterCents(roll.costTotalCents, roll.lengthCmInitial)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {rolls.some((roll) => roll.lengthEstimated) && (
        <p className="text-sm text-muted-foreground">{t.estimatedHint}</p>
      )}
    </div>
  );
}
