'use client';

import { SearchIcon, TruckIcon, UserPlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { messages } from '@/i18n';
import { type SupplierSummary, useLiveQuery, useRepositories, useSession } from '@/local-db';
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
import { SupplierDialog } from './supplier-dialog';
import { SupplierStatusBadge } from './supplier-parts';
import {
  type DirectoryFilter,
  type DirectorySort,
  directoryStats,
  filterCounts,
  filterSuppliers,
  sortSuppliers,
  supplierStatusOf,
} from './supplier-view';

const t = messages.payables;
const FILTERS = ['all', 'owing', 'settled'] as const satisfies readonly DirectoryFilter[];
const SORTS = ['name', 'largest', 'oldest'] as const satisfies readonly DirectorySort[];

/**
 * The supplier directory (/payables): who the shop buys from and what it owes each, at a glance.
 * Every supplier is listed, owed or not; the owner adds one here (a partner only reads).
 */
export function SuppliersScreen() {
  const repositories = useRepositories();
  const navigation = useAppNavigation();
  const isOwner = useSession().user?.role === 'owner';
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<DirectoryFilter>('all');
  const [sort, setSort] = useState<DirectorySort>('name');
  const [adding, setAdding] = useState(false);
  const everyone = useLiveQuery(() => repositories.supplierAccounts.list(), [repositories]);
  const today = shopToday();

  const found = useMemo(
    () =>
      (everyone ?? []).filter(({ supplier }) =>
        matchesSearch(search, [supplier.name, supplier.phone, supplier.notes]),
      ),
    [everyone, search],
  );
  const counts = useMemo(() => filterCounts(found), [found]);
  const rows = useMemo(
    () => sortSuppliers(filterSuppliers(found, filter), sort),
    [found, filter, sort],
  );
  const stats = useMemo(() => directoryStats(everyone ?? []), [everyone]);
  const searching = search.trim() !== '' || filter !== 'all';
  // The list of who is owed is empty because nobody is, not because the search found nothing.
  const nobodyOwed = filter === 'owing' && search.trim() === '';

  const addButton = (variant: 'accent' | 'outline') =>
    isOwner && (
      <Button
        variant={variant}
        onClick={() => {
          setAdding(true);
        }}
      >
        <UserPlusIcon aria-hidden />
        {t.add}
      </Button>
    );

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4">
      <OfflineNotice />
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="grid gap-0.5">
          <h2 className="font-heading text-xl font-semibold">{t.title}</h2>
          <p className="text-sm text-muted-foreground">{t.description}</p>
        </div>
        {addButton('accent')}
      </header>

      {everyone === undefined ? (
        <LoadingState rows={5} />
      ) : everyone.length === 0 ? (
        <EmptyState
          icon={TruckIcon}
          title={t.emptyTitle}
          description={t.emptyDescription}
          action={addButton('outline') || undefined}
        />
      ) : (
        <>
          <dl
            aria-label={t.stats.label}
            className="grid grid-cols-3 rounded-lg border bg-card [&>div+div]:border-s"
          >
            <Stat label={t.stats.suppliers} value={<span data-num>{stats.suppliers}</span>} />
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
              icon={TruckIcon}
              title={nobodyOwed ? t.noDebtsTitle : t.noMatchTitle}
              description={nobodyOwed ? t.noDebtsDescription : t.noMatchDescription}
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
                    <DirectoryRow key={summary.supplier.id} summary={summary} today={today} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
      <SupplierDialog
        open={adding}
        onOpenChange={setAdding}
        onSaved={(supplierId) => {
          navigation.push(`/payables/view?id=${supplierId}`);
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

/** One supplier: the whole row opens the profile (the name is the link, stretched over it). */
function DirectoryRow({ summary, today }: { summary: SupplierSummary; today: string }) {
  const { supplier, account, lastActivity } = summary;
  const status = supplierStatusOf(account);
  return (
    <TableRow className="relative h-14">
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar name={supplier.name} className="max-sm:hidden" />
          <div className="grid min-w-0">
            <Link
              href={`/payables/view?id=${supplier.id}`}
              className="truncate font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring"
            >
              {supplier.name}
            </Link>
            {supplier.phone && (
              <bdi dir="ltr" data-num className="text-start text-xs text-muted-foreground">
                {supplier.phone}
              </bdi>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell>
        <SupplierStatusBadge status={status} />
      </TableCell>
      <TableCell className="text-end">
        {status === 'owing' ? (
          <Money cents={account.owedCents} tone="debt" className="font-semibold" />
        ) : status === 'advance' ? (
          <Money cents={account.advanceCents} tone="capital" />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-end text-muted-foreground max-md:hidden">
        <div className="grid">
          {lastActivity ? <DateText value={lastActivity} /> : <span>—</span>}
          {status === 'owing' && account.oldestDueDate && (
            <span className="text-xs">
              {t.columns.since}:{' '}
              {messages.customers.ageDays(daysBetween(account.oldestDueDate, today))}
            </span>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
