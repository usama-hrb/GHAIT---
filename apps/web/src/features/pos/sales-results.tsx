'use client';

import { ReceiptTextIcon } from 'lucide-react';
import Link from 'next/link';
import { messages } from '@/i18n';
import type { SaleSummary } from '@/local-db';
import { DateText, formatDate, Money } from '@/shared/format';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { statusOf } from './sales-history';

const t = messages.sales;
const h = messages.sales.history;

/** What a sale is: voided, or how far it is paid, with the two flags that change what to do. */
export function SaleStatus({ row }: { row: SaleSummary }) {
  const status = statusOf(row);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {status === 'voided' && <Badge variant="destructive">{h.status.voided}</Badge>}
      {status === 'paid' && <Badge variant="success">{h.status.paid}</Badge>}
      {status === 'partial' && <Badge variant="warning">{h.status.partial}</Badge>}
      {status === 'unpaid' && (
        <Badge variant="outline" className="border-debt text-debt">
          {h.status.unpaid}
        </Badge>
      )}
      {row.writtenOff && status !== 'voided' && (
        <Badge variant="secondary">{h.status.writtenOff}</Badge>
      )}
      {row.overdue && <Badge variant="outline">{h.status.overdue}</Badge>}
    </span>
  );
}

const customerOf = (row: SaleSummary): string => row.customerName ?? t.walkIn;

/** Paid and remaining of a sale: nothing to show on a voided one, a dash for nothing left. */
function Remaining({ row }: { row: SaleSummary }) {
  if (row.sale.voidedAt !== null || row.dueCents === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return <Money cents={row.dueCents} tone="debt" />;
}

function Paid({ row }: { row: SaleSummary }) {
  if (row.sale.voidedAt !== null) return <span className="text-muted-foreground">—</span>;
  return <Money cents={row.paidCents} />;
}

function Total({ row }: { row: SaleSummary }) {
  return (
    <Money
      cents={row.netTotalCents}
      className={cn(row.sale.voidedAt !== null && 'text-muted-foreground line-through')}
    />
  );
}

/**
 * The sales as a full-width table (desktop and tablet landscape): the date opens the details
 * drawer, so does the row; the receipt icon goes to the invoice page.
 */
export function SalesTable({
  rows,
  selectedId,
  onOpen,
}: {
  rows: readonly SaleSummary[];
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{h.columns.date}</TableHead>
          <TableHead>{h.columns.customer}</TableHead>
          <TableHead className="text-end max-xl:hidden">{h.columns.items}</TableHead>
          <TableHead className="text-end">{h.columns.total}</TableHead>
          <TableHead className="text-end">{h.columns.paid}</TableHead>
          <TableHead className="text-end">{h.columns.remaining}</TableHead>
          <TableHead>{h.columns.status}</TableHead>
          <TableHead className="w-14">
            <span className="sr-only">{h.columns.actions}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.sale.id}
            data-state={row.sale.id === selectedId ? 'selected' : undefined}
            className="h-14 cursor-pointer"
            onClick={() => {
              onOpen(row.sale.id);
            }}
          >
            <TableCell>
              <button
                type="button"
                className="-m-2 rounded-md p-2 text-start underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                aria-label={h.openDetails(customerOf(row), formatDate(row.sale.date, 'medium'))}
                aria-haspopup="dialog"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpen(row.sale.id);
                }}
              >
                <DateText value={row.sale.date} />
              </button>
            </TableCell>
            <TableCell className="max-w-56 truncate">{customerOf(row)}</TableCell>
            <TableCell className="text-end max-xl:hidden" data-num>
              {row.lineCount}
            </TableCell>
            <TableCell className="text-end">
              <Total row={row} />
            </TableCell>
            <TableCell className="text-end">
              <Paid row={row} />
            </TableCell>
            <TableCell className="text-end">
              <Remaining row={row} />
            </TableCell>
            <TableCell>
              <SaleStatus row={row} />
            </TableCell>
            <TableCell>
              <Button asChild variant="ghost" size="icon">
                <Link
                  href={`/pos/view?id=${row.sale.id}`}
                  aria-label={h.openInvoice}
                  title={h.openInvoice}
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                >
                  <ReceiptTextIcon aria-hidden />
                </Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** The sales as cards (tablet portrait and phone): the whole card opens the details. */
export function SalesCards({
  rows,
  selectedId,
  onOpen,
}: {
  rows: readonly SaleSummary[];
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <ul className="grid gap-2 p-2 sm:grid-cols-2">
      {rows.map((row) => (
        <li key={row.sale.id}>
          <button
            type="button"
            aria-label={h.openDetails(customerOf(row), formatDate(row.sale.date, 'medium'))}
            aria-haspopup="dialog"
            aria-current={row.sale.id === selectedId ? 'true' : undefined}
            className={cn(
              'grid min-h-14 w-full gap-2 rounded-lg border bg-card p-3 text-start transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
              row.sale.id === selectedId && 'bg-muted',
            )}
            onClick={() => {
              onOpen(row.sale.id);
            }}
          >
            <span className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="block truncate font-medium">{customerOf(row)}</span>
                <span className="flex flex-wrap gap-x-2 text-sm text-muted-foreground">
                  <DateText value={row.sale.date} className="whitespace-nowrap" />
                  <span className="whitespace-nowrap">{h.itemsCount(row.lineCount)}</span>
                </span>
              </span>
              <SaleStatus row={row} />
            </span>
            <span className="grid grid-cols-3 gap-2 text-sm">
              <span className="grid">
                <span className="text-xs text-muted-foreground">{h.columns.total}</span>
                <Total row={row} />
              </span>
              <span className="grid">
                <span className="text-xs text-muted-foreground">{h.columns.paid}</span>
                <Paid row={row} />
              </span>
              <span className="grid">
                <span className="text-xs text-muted-foreground">{h.columns.remaining}</span>
                <Remaining row={row} />
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
