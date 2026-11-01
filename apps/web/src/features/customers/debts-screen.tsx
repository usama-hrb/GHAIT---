'use client';

import { HandCoinsIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories } from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice } from '@/shared/brand';
import { DateText, Money } from '@/shared/format';
import { daysBetween, shopToday } from '@/shared/lib/dates';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs';

const t = messages.customers;

/** "Who owes me" (SPEC §4.1, BUILD_PROMPTS 3.5): by the oldest debt or the largest. */
export function DebtsScreen() {
  const repositories = useRepositories();
  const [order, setOrder] = useState<'oldest' | 'largest'>('oldest');
  const debts = useLiveQuery(() => repositories.accounts.debts(order), [repositories, order]);
  const today = shopToday();

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4">
      <OfflineNotice />
      <Button asChild variant="link" className="justify-self-start px-0">
        <Link href="/customers">{t.back}</Link>
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-xl font-semibold">{t.debtsTitle}</h2>
        <Tabs
          value={order}
          onValueChange={(next) => {
            setOrder(next as 'oldest' | 'largest');
          }}
        >
          <TabsList aria-label={t.sort.label}>
            <TabsTrigger value="oldest">{t.sort.oldest}</TabsTrigger>
            <TabsTrigger value="largest">{t.sort.largest}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {debts === undefined ? (
        <LoadingState />
      ) : debts.length === 0 ? (
        <EmptyState icon={HandCoinsIcon} title={t.noDebts} />
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.columns.name}</TableHead>
                <TableHead className="text-end">{t.columns.owed}</TableHead>
                <TableHead className="text-end">{t.columns.since}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {debts.map(({ customer, account }) => (
                <TableRow key={customer.id} className="h-12">
                  <TableCell>
                    <Link
                      href={`/customers/view?id=${customer.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {customer.name}
                    </Link>
                    {account.overdueCents > 0 && (
                      <Badge variant="destructive" className="ms-1.5">
                        {t.status.overdue}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-end">
                    <Money cents={account.collectibleCents} tone="debt" />
                  </TableCell>
                  <TableCell className="text-end">
                    {account.oldestOpenDate && (
                      <span className="grid">
                        <DateText value={account.oldestOpenDate} />
                        <span className="text-xs text-muted-foreground">
                          {t.ageDays(daysBetween(account.oldestOpenDate, today))}
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
