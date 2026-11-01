'use client';

import { ReceiptIcon } from 'lucide-react';
import Link from 'next/link';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories } from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice } from '@/shared/brand';
import { DateText, Money } from '@/shared/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

const t = messages.sales;

/** Sales made on this device or pulled from the server, newest first (/pos/history). */
export function SalesListScreen() {
  const repositories = useRepositories();
  const sales = useLiveQuery(() => repositories.sales.list(), [repositories]);

  if (sales === undefined) return <LoadingState />;
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4">
      <OfflineNotice />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-xl font-semibold">{t.listTitle}</h2>
        <Button asChild variant="accent">
          <Link href="/pos">{messages.pos.title}</Link>
        </Button>
      </div>
      {sales.length === 0 ? (
        <EmptyState icon={ReceiptIcon} title={t.emptyTitle} description={t.emptyDescription} />
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.columns.date}</TableHead>
                <TableHead>{t.columns.customer}</TableHead>
                <TableHead className="text-end max-sm:hidden">{t.columns.lines}</TableHead>
                <TableHead className="text-end">{t.columns.total}</TableHead>
                <TableHead className="text-end">{t.columns.due}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.map(({ sale, customerName, lineCount, netTotalCents, dueCents }) => (
                <TableRow key={sale.id} className="h-12">
                  <TableCell>
                    <Link
                      href={`/pos/view?id=${sale.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      <DateText value={sale.date} />
                    </Link>
                    {sale.voidedAt !== null && (
                      <Badge variant="destructive" className="ms-1.5">
                        {t.voided}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{customerName ?? t.walkIn}</TableCell>
                  <TableCell className="text-end max-sm:hidden" data-num>
                    {lineCount}
                  </TableCell>
                  <TableCell className="text-end">
                    <Money cents={netTotalCents} />
                  </TableCell>
                  <TableCell className="text-end">
                    {dueCents > 0 ? <Money cents={dueCents} tone="debt" /> : '—'}
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
