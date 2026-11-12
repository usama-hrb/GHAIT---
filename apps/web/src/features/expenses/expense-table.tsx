'use client';

import type { Expense } from '@fabric/contracts';
import { MoreHorizontalIcon } from 'lucide-react';
import { isLockedOn, LockedBadge } from '@/features/settlements';
import { messages } from '@/i18n';
import type { Local, MonthRow } from '@/local-db';
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
import { statusOfRow } from './expense-view';

const t = messages.expenses;

/**
 * The month's expenses: what each was, when, how much, and whether it is paid (and when). The
 * actions sit in one menu per row. A partner only reads; an expense paid in a settled, locked
 * period is not offered for change (S11).
 */
export function ExpenseTable({
  rows,
  categoryLabel,
  canWrite,
  lockedThrough,
  onMarkPaid,
  onEdit,
  onVoid,
}: {
  rows: readonly MonthRow[];
  categoryLabel: (key: string) => string;
  canWrite: boolean;
  lockedThrough: string | null | undefined;
  onMarkPaid: (expense: Local<Expense>) => void;
  onEdit: (expense: Local<Expense>) => void;
  onVoid: (expense: Local<Expense>) => void;
}) {
  return (
    <div className="rounded-lg border bg-card">
      <Table stack>
        <TableHeader>
          <TableRow>
            <TableHead>{t.columns.expense}</TableHead>
            <TableHead>{t.columns.date}</TableHead>
            <TableHead className="text-end">{t.columns.amount}</TableHead>
            <TableHead>{t.columns.status}</TableHead>
            {canWrite && (
              <TableHead className="w-10">
                <span className="sr-only">{t.actions}</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const { expense } = row;
            const paid = statusOfRow(row) === 'paid';
            const locked = isLockedOn(expense.paidDate, lockedThrough);
            return (
              <TableRow key={expense.id} className="sm:h-14">
                <TableCell>
                  <div className="grid min-w-0 gap-0.5">
                    <span className="font-medium">{categoryLabel(expense.category)}</span>
                    {row.employeeName !== null && expense.salaryMonth !== null && (
                      <span className="max-w-56 truncate text-xs text-muted-foreground">
                        {t.salaryFor(
                          row.employeeName,
                          formatDate(`${expense.salaryMonth}-01`, 'month'),
                        )}
                      </span>
                    )}
                    {expense.note && (
                      <span className="max-w-56 truncate text-xs text-muted-foreground">
                        {expense.note}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground" label={t.columns.date}>
                  <DateText value={expense.date} />
                </TableCell>
                <TableCell className="text-end font-medium" label={t.columns.amount}>
                  <Money cents={expense.amountCents} />
                </TableCell>
                <TableCell label={t.columns.status}>
                  <div className="grid justify-items-start gap-0.5">
                    <Badge variant={paid ? 'success' : 'warning'}>
                      {paid ? t.status.paid : t.status.unpaid}
                    </Badge>
                    {expense.paidDate && (
                      <span className="text-xs text-muted-foreground">
                        {t.status.paidOn} <DateText value={expense.paidDate} />
                      </span>
                    )}
                    {row.carriedOver && (
                      <span className="text-xs text-muted-foreground">{t.status.carriedOver}</span>
                    )}
                    {row.countsIn && (
                      <span className="text-xs text-muted-foreground">
                        {t.status.countsIn} <DateText value={`${row.countsIn}-01`} format="month" />
                      </span>
                    )}
                  </div>
                </TableCell>
                {canWrite && (
                  <TableCell className="text-end">
                    {locked ? (
                      <LockedBadge lockedThrough={lockedThrough} />
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`${t.actions}: ${categoryLabel(expense.category)}`}
                          >
                            <MoreHorizontalIcon aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {!paid && (
                            <DropdownMenuItem
                              onSelect={() => {
                                onMarkPaid(expense);
                              }}
                            >
                              {t.markPaid}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onSelect={() => {
                              onEdit(expense);
                            }}
                          >
                            {messages.forms.edit}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => {
                              onVoid(expense);
                            }}
                          >
                            {t.voidTitle}
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
