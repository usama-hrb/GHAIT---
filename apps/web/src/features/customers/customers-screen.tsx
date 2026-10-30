'use client';

import { UserPlusIcon, UsersIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories } from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice } from '@/shared/brand';
import { Money } from '@/shared/format';
import { daysBetween, shopToday } from '@/shared/lib/dates';
import { useAppNavigation } from '@/shared/lib/navigation';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { CustomerDialog } from './customer-dialog';

const t = messages.customers;

/** Customers with their balance and the age of their debt (BUILD_PROMPTS 3.5, /customers). */
export function CustomersScreen() {
  const repositories = useRepositories();
  const navigation = useAppNavigation();
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const customers = useLiveQuery(() => repositories.accounts.list(search), [repositories, search]);
  const today = shopToday();

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4">
      <OfflineNotice />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-xl font-semibold">{t.listTitle}</h2>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/customers/debts">{t.debtsTitle}</Link>
          </Button>
          <Button
            variant="accent"
            onClick={() => {
              setAdding(true);
            }}
          >
            <UserPlusIcon aria-hidden />
            {t.add}
          </Button>
        </div>
      </div>
      <Input
        type="search"
        aria-label={t.search}
        placeholder={t.search}
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
        }}
      />
      {customers === undefined ? (
        <LoadingState />
      ) : customers.length === 0 ? (
        <EmptyState icon={UsersIcon} title={t.emptyTitle} description={t.emptyDescription} />
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.columns.name}</TableHead>
                <TableHead className="max-sm:hidden">{t.columns.phone}</TableHead>
                <TableHead className="text-end">{t.columns.balance}</TableHead>
                <TableHead className="text-end">{t.columns.since}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map(({ customer, account }) => (
                <TableRow key={customer.id} className="h-12">
                  <TableCell>
                    <Link
                      href={`/customers/view?id=${customer.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {customer.name}
                    </Link>
                  </TableCell>
                  <TableCell className="max-sm:hidden">
                    <bdi dir="ltr" data-num>
                      {customer.phone}
                    </bdi>
                  </TableCell>
                  <TableCell className="text-end">
                    <Balance cents={account.balanceCents} />
                  </TableCell>
                  <TableCell className="text-end text-muted-foreground">
                    {account.oldestOpenDate
                      ? t.ageDays(daysBetween(account.oldestOpenDate, today))
                      : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <CustomerDialog
        open={adding}
        onOpenChange={setAdding}
        onSaved={(customerId) => {
          navigation.push(`/customers/view?id=${customerId}`);
        }}
      />
    </div>
  );
}

/** Owed by the customer (debt), or held for them (credit, labelled as such). */
export function Balance({ cents }: { cents: number }) {
  if (cents > 0) return <Money cents={cents} tone="debt" />;
  if (cents < 0) {
    return (
      <span>
        <span className="text-muted-foreground">{t.account.credit}: </span>
        <Money cents={-cents} tone="capital" />
      </span>
    );
  }
  return <Money cents={0} />;
}
