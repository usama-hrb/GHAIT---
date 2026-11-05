'use client';

import { MoreHorizontalIcon } from 'lucide-react';
import Link from 'next/link';
import { messages } from '@/i18n';
import { DateText, formatDate, Money } from '@/shared/format';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { InvoiceStatusBadge } from './customer-parts';
import type { InvoiceRow } from './customer-view';

const t = messages.customers;

/** Something can still be paid on the invoice (a bad debt too: that payment is a recovery). */
export const canPay = (row: InvoiceRow): boolean => (row.invoice?.dueCents ?? 0) > 0;
/** Only a debt still expected can be written off. */
export const canWriteOffRow = (row: InvoiceRow): boolean =>
  row.invoice !== undefined && row.invoice.dueCents > 0 && !row.invoice.writtenOff;

/** What is on the invoice before goods were given back; what is returned shows under it. */
export const originalTotalOf = (row: InvoiceRow): number =>
  row.invoice ? row.invoice.totalCents + row.invoice.returnedCents : row.sale.totalCents;

/**
 * The customer's invoices: what each was, what was paid, what is left and where it stands. The
 * actions of one invoice (see it, pay it, write it off) are in its menu; the write-off is the
 * owner's, so a cashier is never offered it.
 */
export function InvoiceTable({
  rows,
  canWriteOff,
  onPay,
  onWriteOff,
}: {
  rows: readonly InvoiceRow[];
  canWriteOff: boolean;
  onPay: (saleId: string) => void;
  onWriteOff: (row: InvoiceRow) => void;
}) {
  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t.columns.date}</TableHead>
            <TableHead className="text-end max-md:hidden">{t.columns.total}</TableHead>
            <TableHead className="text-end max-md:hidden">{t.columns.paid}</TableHead>
            <TableHead className="text-end">{t.columns.due}</TableHead>
            <TableHead>{t.columns.status}</TableHead>
            <TableHead className="w-10">
              <span className="sr-only">{t.invoiceActions}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const { sale, invoice } = row;
            const returned = invoice?.returnedCents ?? 0;
            return (
              <TableRow key={sale.id} className="h-12">
                <TableCell>
                  <Link
                    href={`/pos/view?id=${sale.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    <DateText value={sale.date} />
                  </Link>
                  {sale.dueDate && invoice && invoice.dueCents > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {t.dueOn} <DateText value={sale.dueDate} />
                    </p>
                  )}
                </TableCell>
                <TableCell className="text-end max-md:hidden">
                  <Money cents={originalTotalOf(row)} />
                  {returned > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {t.returned} <Money cents={returned} />
                    </p>
                  )}
                </TableCell>
                <TableCell className="text-end max-md:hidden">
                  {invoice ? <Money cents={invoice.paidCents} /> : '—'}
                </TableCell>
                <TableCell className="text-end">
                  {invoice && invoice.dueCents > 0 ? (
                    <Money cents={invoice.dueCents} tone="debt" className="font-semibold" />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <InvoiceStatusBadge status={row.status} />
                </TableCell>
                <TableCell className="text-end">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${t.invoiceActions}: ${formatDate(sale.date)}`}
                      >
                        <MoreHorizontalIcon aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/pos/view?id=${sale.id}`}>{t.viewInvoice}</Link>
                      </DropdownMenuItem>
                      {canPay(row) && (
                        <DropdownMenuItem
                          onSelect={() => {
                            onPay(sale.id);
                          }}
                        >
                          {t.payInvoice}
                        </DropdownMenuItem>
                      )}
                      {canWriteOff && canWriteOffRow(row) && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => {
                              onWriteOff(row);
                            }}
                          >
                            {t.writeOff}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
