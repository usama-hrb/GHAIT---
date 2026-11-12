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
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { PurchaseStatusBadge } from './supplier-parts';
import type { PurchaseRow } from './supplier-view';

const t = messages.payables;

/** What the purchase brought in, as a short line: the products, then the codes of its batches. */
export function PurchaseContents({ row }: { row: PurchaseRow }) {
  const { productNames, batchCodes } = row.record;
  if (productNames.length === 0 && batchCodes.length === 0) return null;
  return (
    <p className="max-w-64 truncate text-xs text-muted-foreground">
      {productNames.join('، ')}
      {batchCodes.length > 0 && (
        <>
          {productNames.length > 0 && ' · '}
          <bdi dir="ltr" data-num>
            {batchCodes.join(' ')}
          </bdi>
        </>
      )}
    </p>
  );
}

/**
 * The supplier's purchases: what each cost, what was settled (at the till and by payments), what
 * is left and where it stands. A purchase opens its own page (its items and batch costs); paying
 * towards it is the owner's, so a partner's menu offers only to look.
 */
export function PurchaseTable({
  rows,
  canPay,
  onPay,
}: {
  rows: readonly PurchaseRow[];
  canPay: boolean;
  onPay: (purchaseId: string) => void;
}) {
  return (
    <div className="rounded-lg border bg-card">
      <Table stack>
        <TableHeader>
          <TableRow>
            <TableHead>{t.columns.purchase}</TableHead>
            <TableHead className="text-end">{t.columns.total}</TableHead>
            <TableHead className="text-end">{t.columns.paid}</TableHead>
            <TableHead className="text-end">{t.columns.due}</TableHead>
            <TableHead>{t.columns.status}</TableHead>
            <TableHead className="w-10">
              <span className="sr-only">{t.purchaseActions}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const { purchase } = row.record;
            const dueCents = row.due?.dueCents ?? 0;
            return (
              <TableRow key={purchase.id} className="sm:h-14">
                <TableCell>
                  <Link
                    href={`/purchases/view?id=${purchase.id}`}
                    className="underline-offset-4 hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
                  >
                    <DateText value={purchase.date} />
                  </Link>
                  <PurchaseContents row={row} />
                </TableCell>
                <TableCell className="text-end" label={t.columns.total}>
                  <Money cents={purchase.totalCostCents} />
                </TableCell>
                <TableCell className="text-end" label={t.columns.paid}>
                  <Money cents={row.due?.settledCents ?? purchase.totalCostCents} />
                </TableCell>
                <TableCell className="text-end" label={t.columns.due}>
                  {dueCents > 0 ? (
                    <Money cents={dueCents} tone="debt" className="font-semibold" />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell label={t.columns.status}>
                  <PurchaseStatusBadge status={row.status} />
                </TableCell>
                <TableCell className="text-end">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${t.purchaseActions}: ${formatDate(purchase.date)}`}
                      >
                        <MoreHorizontalIcon aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/purchases/view?id=${purchase.id}`}>{t.viewPurchase}</Link>
                      </DropdownMenuItem>
                      {canPay && dueCents > 0 && (
                        <DropdownMenuItem
                          onSelect={() => {
                            onPay(purchase.id);
                          }}
                        >
                          {t.payPurchase}
                        </DropdownMenuItem>
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
