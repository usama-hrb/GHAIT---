'use client';

import { SearchIcon, UserPlusIcon, UsersIcon } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { messages } from '@/i18n';
import { type CustomerSummary, useLiveQuery, useRepositories } from '@/local-db';
import { Avatar, EmptyState, LoadingState, OfflineNotice } from '@/shared/brand';
import { DateText, Money } from '@/shared/format';
import { daysBetween, shopToday } from '@/shared/lib/dates';
import { useAppNavigation } from '@/shared/lib/navigation';
import { matchesSearch } from '@/shared/lib/search';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { CustomerDialog } from './customer-dialog';
import { AccountStatusBadge } from './customer-parts';
import {
  accountStatusOf,
  type DirectoryFilter,
  type DirectorySort,
  directoryStats,
  filterCounts,
  filterCustomers,
  sortCustomers,
} from './customer-view';

const t = messages.customers;
const FILTERS = ['all', 'owing', 'settled'] as const satisfies readonly DirectoryFilter[];
const SORTS = ['name', 'largest', 'oldest'] as const satisfies readonly DirectorySort[];

/**
 * The customer directory (/customers): who the shop sells to and what each owes, at a glance.
 * With `debts` it opens on the customers who owe, oldest debt first (/customers/debts).
 */
export function CustomersScreen({ debts = false }: { debts?: boolean }) {
  const repositories = useRepositories();
  const navigation = useAppNavigation();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<DirectoryFilter>(debts ? 'owing' : 'all');
  const [sort, setSort] = useState<DirectorySort>(debts ? 'oldest' : 'name');
  const [adding, setAdding] = useState(false);
  const everyone = useLiveQuery(() => repositories.accounts.list(), [repositories]);
  const today = shopToday();

  const found = useMemo(
    () =>
      (everyone ?? []).filter(({ customer }) =>
        matchesSearch(search, [customer.name, customer.phone, customer.notes]),
      ),
    [everyone, search],
  );
  const counts = useMemo(() => filterCounts(found), [found]);
  const rows = useMemo(
    () => sortCustomers(filterCustomers(found, filter), sort),
    [found, filter, sort],
  );
  const stats = useMemo(() => directoryStats(everyone ?? []), [everyone]);
  const searching = search.trim() !== '' || filter !== 'all';
  // The list of who owes is empty because nobody does, not because the search found nothing.
  const nobodyOwes = filter === 'owing' && search.trim() === '';

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4">
      <OfflineNotice />
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="grid gap-0.5">
          <h2 className="font-heading text-xl font-semibold">
            {debts ? t.debtsTitle : t.listTitle}
          </h2>
          <p className="text-sm text-muted-foreground">{t.listDescription}</p>
        </div>
        <Button
          variant="accent"
          onClick={() => {
            setAdding(true);
          }}
        >
          <UserPlusIcon aria-hidden />
          {t.add}
        </Button>
      </header>

      {everyone === undefined ? (
        <LoadingState rows={5} />
      ) : everyone.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title={t.emptyTitle}
          description={t.emptyDescription}
          action={
            <Button
              variant="outline"
              onClick={() => {
                setAdding(true);
              }}
            >
              <UserPlusIcon aria-hidden />
              {t.add}
            </Button>
          }
        />
      ) : (
        <>
          <dl
            aria-label={t.stats.label}
            className="grid grid-cols-3 rounded-lg border bg-card [&>div+div]:border-s"
          >
            <Stat label={t.stats.customers} value={<span data-num>{stats.customers}</span>} />
            <Stat label={t.stats.owing} value={<span data-num>{stats.owing}</span>} />
            <Stat
              label={t.stats.owed}
              value={
                <Money cents={stats.owedCents} tone={stats.owedCents > 0 ? 'debt' : undefined} />
              }
            />
          </dl>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative order-1 min-w-40 flex-1">
              <SearchIcon
                aria-hidden
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                aria-label={t.search}
                placeholder={t.search}
                className="ps-9"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
              />
            </div>
            <Tabs
              className="order-2 max-sm:order-3 max-sm:w-full"
              value={filter}
              onValueChange={(next) => {
                setFilter(next as DirectoryFilter);
              }}
            >
              <TabsList aria-label={t.filters.label} className="max-sm:w-full">
                {FILTERS.map((option) => (
                  <TabsTrigger key={option} value={option} className="px-3">
                    {t.filters[option]}
                    <span data-num className="text-xs text-muted-foreground">
                      {counts[option]}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Select
              value={sort}
              onValueChange={(next) => {
                setSort(next as DirectorySort);
              }}
            >
              <SelectTrigger
                aria-label={t.sort.label}
                className="order-3 w-40 max-sm:order-2 max-sm:w-36"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORTS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {t.sort[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              icon={UsersIcon}
              title={nobodyOwes ? t.noDebtsTitle : t.noMatchTitle}
              description={nobodyOwes ? t.noDebtsDescription : t.noMatchDescription}
              action={
                searching ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearch('');
                      setFilter('all');
                    }}
                  >
                    {t.showAll}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.columns.name}</TableHead>
                    <TableHead>{t.columns.status}</TableHead>
                    <TableHead className="text-end">{t.columns.outstanding}</TableHead>
                    <TableHead className="text-end max-md:hidden">{t.columns.activity}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((summary) => (
                    <DirectoryRow key={summary.customer.id} summary={summary} today={today} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
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

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 px-3 py-2.5 sm:px-4">
      <dt className="text-xs text-muted-foreground sm:text-sm">{label}</dt>
      <dd className="font-heading text-lg font-semibold sm:text-xl">{value}</dd>
    </div>
  );
}

/** One customer: the whole row opens the profile (the name is the link, stretched over it). */
function DirectoryRow({ summary, today }: { summary: CustomerSummary; today: string }) {
  const { customer, account, lastActivity } = summary;
  const status = accountStatusOf(account);
  return (
    <TableRow className="relative h-14">
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar name={customer.name} className="max-sm:hidden" />
          <div className="grid min-w-0">
            <Link
              href={`/customers/view?id=${customer.id}`}
              className="truncate font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring"
            >
              {customer.name}
            </Link>
            {customer.phone && (
              <bdi dir="ltr" data-num className="text-start text-xs text-muted-foreground">
                {customer.phone}
              </bdi>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell>
        <AccountStatusBadge status={status} account={account} />
      </TableCell>
      <TableCell className="text-end">
        {status === 'owing' ? (
          <Money cents={account.collectibleCents} tone="debt" className="font-semibold" />
        ) : status === 'credit' ? (
          <Money cents={account.creditCents} tone="capital" />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-end text-muted-foreground max-md:hidden">
        <div className="grid">
          {lastActivity ? <DateText value={lastActivity} /> : <span>—</span>}
          {status === 'owing' && account.oldestOpenDate && (
            <span className="text-xs">
              {t.columns.since}: {t.ageDays(daysBetween(account.oldestOpenDate, today))}
            </span>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
