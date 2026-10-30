'use client';

import { PlusIcon, TruckIcon } from 'lucide-react';
import Link from 'next/link';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories } from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice } from '@/shared/brand';
import { DateAr, Money } from '@/shared/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

const t = messages.purchasing;

/** Purchases, newest first (SPEC §14.4). */
export function PurchaseListScreen() {
  const repositories = useRepositories();
  const purchases = useLiveQuery(() => repositories.purchases.list(), [repositories]);

  return (
    <div className="grid gap-4">
      <OfflineNotice />
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="me-auto font-heading text-xl font-semibold">{t.listTitle}</h2>
        <Button asChild variant="accent">
          <Link href="/purchases/new">
            <PlusIcon data-icon="inline-start" aria-hidden />
            {t.newPurchase}
          </Link>
        </Button>
      </div>

      {purchases === undefined ? (
        <LoadingState />
      ) : purchases.length === 0 ? (
        <EmptyState icon={TruckIcon} title={t.emptyTitle} description={t.emptyDescription} />
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.columns.date}</TableHead>
                <TableHead>{t.columns.fabric}</TableHead>
                <TableHead className="max-sm:hidden">{t.columns.supplier}</TableHead>
                <TableHead className="text-end">{t.columns.rolls}</TableHead>
                <TableHead className="text-end">{t.columns.total}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {purchases.map(({ purchase, fabricName, supplierName, rollCount }) => (
                <TableRow key={purchase.id} className="h-12">
                  <TableCell>
                    <Link
                      href={`/purchases/view?id=${purchase.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      <DateAr value={purchase.date} />
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">{fabricName}</span>{' '}
                    <Badge variant="secondary">{t.methods[purchase.method]}</Badge>
                  </TableCell>
                  <TableCell className="max-sm:hidden">{supplierName}</TableCell>
                  <TableCell className="text-end text-sm">{t.rollsCount(rollCount)}</TableCell>
                  <TableCell className="text-end">
                    <Money cents={purchase.totalCostCents} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
