'use client';

import { MoreHorizontalIcon } from 'lucide-react';
import Link from 'next/link';
import { isLockedOn, LockedBadge } from '@/features/settlements';
import { messages } from '@/i18n';
import { DateText, formatDate, Money } from '@/shared/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import type { PaymentRow } from './supplier-view';

const t = messages.payables;

/**
 * Where a payment went (SP2): the purchases it settled, each with the part it took, and, with no
 * purchase of its own, what went beyond all of them (kept as an advance). A voided payment went
 * nowhere.
 */
function AppliedTo({ row }: { row: PaymentRow }) {
  if (row.applied.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <ul className="grid gap-0.5">
      {row.applied.map((part) => (
        <li key={part.purchaseId ?? 'advance'} className="flex flex-wrap items-baseline gap-x-1.5">
          {part.purchaseId === null ? (
            <span>{t.advanceKept}</span>
          ) : (
            <Link
              href={`/purchases/view?id=${part.purchaseId}`}
              className="underline-offset-4 hover:underline"
            >
              {t.purchaseOf} {part.date ? <DateText value={part.date} /> : null}
            </Link>
          )}
          <span className="text-muted-foreground">
            · <Money cents={part.amountCents} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Every payment made to the supplier, newest first, with the purchases it was applied to. A
 * voided payment stays on the list, marked, and no longer counts. Voiding is the owner's, and a
 * payment dated in a settled period waits for the period to be opened.
 */
export function PaymentTable({
  rows,
  canVoid,
  lockedThrough,
  onVoid,
}: {
  rows: readonly PaymentRow[];
  canVoid: boolean;
  lockedThrough: string | null | undefined;
  onVoid: (row: PaymentRow) => void;
}) {
  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t.columns.date}</TableHead>
            <TableHead className="max-sm:hidden">{t.columns.method}</TableHead>
            <TableHead className="max-md:hidden">{t.columns.appliedTo}</TableHead>
            <TableHead className="max-lg:hidden">{t.columns.note}</TableHead>
            <TableHead className="text-end">{t.columns.amount}</TableHead>
            {canVoid && (
              <TableHead className="w-10">
                <span className="sr-only">{t.paymentActions}</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const { payment } = row;
            const voided = payment.voidedAt !== null;
            const locked = isLockedOn(payment.date, lockedThrough);
            return (
              <TableRow key={payment.id} className="h-12" data-voided={voided || undefined}>
                <TableCell>
                  <DateText value={payment.date} className={voided ? 'line-through' : undefined} />
                  {voided && (
                    <Badge variant="outline" className="ms-1.5">
                      {t.voided}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="max-sm:hidden">{t.methods[payment.method]}</TableCell>
                <TableCell className="max-md:hidden">
                  <AppliedTo row={row} />
                </TableCell>
                <TableCell className="max-w-48 truncate text-muted-foreground max-lg:hidden">
                  {payment.note ?? '—'}
                </TableCell>
                <TableCell className="text-end">
                  <Money
                    cents={payment.amountCents}
                    tone={voided ? undefined : 'profit'}
                    className={voided ? 'text-muted-foreground line-through' : undefined}
                  />
                </TableCell>
                {canVoid && (
                  <TableCell className="text-end">
                    {voided ? null : locked ? (
                      <LockedBadge lockedThrough={lockedThrough} />
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`${t.paymentActions}: ${formatDate(payment.date)}`}
                          >
                            <MoreHorizontalIcon aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => {
                              onVoid(row);
                            }}
                          >
                            {t.voidPayment}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
