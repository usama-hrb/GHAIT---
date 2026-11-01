'use client';

import { TruckIcon } from 'lucide-react';
import Link from 'next/link';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories } from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice } from '@/shared/brand';
import { DateText, Money } from '@/shared/format';
import { daysBetween, shopToday } from '@/shared/lib/dates';
import { Badge } from '@/shared/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

const t = messages.payables;

/** Who the shop owes for cloth bought and not paid for in full (SPEC §9, BUILD_PROMPTS 5.3). */
export function PayablesScreen() {
  const repositories = useRepositories();
  const payables = useLiveQuery(() => repositories.supplierAccounts.payables(), [repositories]);
  const today = shopToday();

  if (payables === undefined) return <LoadingState />;
  const total = payables.reduce((sum, { account }) => sum + account.owedCents, 0);
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4">
      <OfflineNotice />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-heading text-xl font-semibold">{t.title}</h2>
        {payables.length > 0 && (
          <p>
            <span className="text-muted-foreground">{t.total}: </span>
            <Money cents={total} tone="debt" className="text-lg font-semibold" />
          </p>
        )}
      </div>
      {payables.length === 0 ? (
        <EmptyState icon={TruckIcon} title={t.emptyTitle} description={t.emptyDescription} />
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.columns.supplier}</TableHead>
                <TableHead className="text-end">{t.columns.owed}</TableHead>
                <TableHead className="text-end">{t.columns.since}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payables.map(({ supplier, account }) => (
                <TableRow key={supplier.id} className="h-12">
                  <TableCell>
                    <Link
                      href={`/payables/view?id=${supplier.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {supplier.name}
                    </Link>
                    {account.advanceCents > 0 && (
                      <Badge variant="secondary" className="ms-1.5">
                        {t.advance}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-end">
                    {account.owedCents > 0 ? (
                      <Money cents={account.owedCents} tone="debt" />
                    ) : (
                      <Money cents={account.advanceCents} />
                    )}
                  </TableCell>
                  <TableCell className="text-end">
                    {account.oldestDueDate && (
                      <span className="grid">
                        <DateText value={account.oldestDueDate} />
                        <span className="text-xs text-muted-foreground">
                          {messages.customers.ageDays(daysBetween(account.oldestDueDate, today))}
                        </span>
                      </span>
                    )}
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
