'use client';

import type { Expense, RecurringExpense } from '@fabric/contracts';
import { monthOf } from '@fabric/core';
import { PlusIcon, ReceiptIcon, SearchIcon } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useLockedThrough } from '@/features/settlements';
import { messages } from '@/i18n';
import { isPeriodLocked, type Local, useLiveQuery, useRepositories, useSession } from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice, VoidDialog } from '@/shared/brand';
import { Money } from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { categoryName } from './category-name';
import { ExpenseDialog } from './expense-dialog';
import { ExpenseTable } from './expense-table';
import {
  dueSoonCount,
  filterByStatus,
  searchRows,
  type StatusFilter,
  statusFilterOf,
  statusCounts,
} from './expense-view';
import { MonthNavigator } from './month-nav';
import { FromTemplateDialog, RecurringDialog, type BillToCreate } from './recurring-dialog';
import { RecurringPanel } from './recurring-panel';

const t = messages.expenses;
const STATUSES = ['all', 'paid', 'unpaid'] as const satisfies readonly StatusFilter[];
/** The category filter's "every category" (a Select item cannot be empty). */
const EVERY_CATEGORY = '*';

/**
 * Expenses (SPEC §5, BUILD_PROMPTS 4.1): the month's bills and what was paid in it, and the monthly
 * templates with when each is next due. Everything is saved on the device first; every total and
 * date here comes from @fabric/core through the repository.
 */
export function ExpensesScreen() {
  const repositories = useRepositories();
  const isOwner = useSession().user?.role === 'owner';
  const lockedThrough = useLockedThrough();
  const today = shopToday();
  const [month, setMonth] = useState(() => monthOf(today));
  const [search, setSearch] = useState('');
  // The Home links here with ?status=unpaid: the list opens on the unpaid ones.
  const requested = useSearchParams().get('status');
  const [status, setStatus] = useState<StatusFilter>(() => statusFilterOf(requested));
  const [category, setCategory] = useState<string | null>(null);
  const [editing, setEditing] = useState<Local<Expense> | 'new' | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<Local<RecurringExpense> | 'new' | null>(
    null,
  );
  const [creating, setCreating] = useState<BillToCreate | null>(null);
  const [voiding, setVoiding] = useState<{ kind: 'expense' | 'template'; id: string } | null>(null);

  const data = useLiveQuery(async () => {
    const [view, categories, bills] = await Promise.all([
      repositories.expenses.month(month),
      repositories.expenses.categories(),
      repositories.expenses.recurringBills(),
    ]);
    return { view, categories, bills };
  }, [repositories, month]);

  const categories = useMemo(() => data?.categories ?? [], [data]);
  const categoryLabel = useMemo(
    () => (key: string) => {
      const found = categories.find((candidate) => candidate.key === key);
      return found ? categoryName(found) : key;
    },
    [categories],
  );
  const rows = useMemo(() => data?.view.rows ?? [], [data]);
  const found = useMemo(
    () => searchRows(rows, { search, category }, categoryLabel),
    [rows, search, category, categoryLabel],
  );
  const counts = useMemo(() => statusCounts(found), [found]);
  const shown = useMemo(() => filterByStatus(found, status), [found, status]);

  const markPaid = (expense: Local<Expense>) => {
    repositories.expenses.setPaid(expense.id, shopToday()).then(
      () => toast.success(t.markedPaid, { description: messages.forms.saved }),
      (error: unknown) =>
        toast.error(isPeriodLocked(error) ? messages.forms.periodLocked : t.form.failed),
    );
  };

  const toggleTemplate = (template: Local<RecurringExpense>) => {
    void repositories.expenses.saveTemplate(
      {
        name: template.name,
        category: template.category,
        amountCents: template.amountCents,
        dayOfMonth: template.dayOfMonth,
        active: !template.active,
      },
      template.id,
    );
  };

  const filtering = search.trim() !== '' || status !== 'all' || category !== null;
  const resetFilters = () => {
    setSearch('');
    setStatus('all');
    setCategory(null);
  };
  const addExpense = () => {
    setEditing('new');
  };

  const dueSoon = dueSoonCount(data?.bills ?? []);
  const view = data?.view;
  const totals = view?.totals;

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4">
      <OfflineNotice />
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="grid gap-0.5">
          <h2 className="font-heading text-xl font-semibold">{t.title}</h2>
          <p className="text-sm text-muted-foreground">{t.description}</p>
        </div>
        {isOwner && (
          <Button variant="accent" onClick={addExpense}>
            <PlusIcon aria-hidden />
            {t.add}
          </Button>
        )}
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <MonthNavigator month={month} today={today} onChange={setMonth} />
        {dueSoon > 0 && (
          <Button asChild variant="outline" size="sm" className="xl:hidden">
            <a href="#recurring">
              {t.recurring.title}
              <Badge variant="warning">{t.recurring.dueCount(dueSoon)}</Badge>
            </a>
          </Button>
        )}
      </div>

      {data === undefined || view === undefined || totals === undefined ? (
        <LoadingState rows={5} />
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <dl
                aria-label={t.stats.label}
                className="grid grid-cols-2 rounded-lg border bg-card sm:grid-cols-4 [&>div]:border-s max-sm:[&>div:nth-child(n+3)]:border-t max-sm:[&>div:nth-child(odd)]:border-s-0 sm:[&>div:first-child]:border-s-0"
              >
                <Stat label={t.stats.total} value={<Money cents={totals.totalCents} />} />
                <Stat label={t.stats.paid} value={<Money cents={totals.paidCents} />} />
                <Stat
                  label={t.stats.unpaid}
                  value={
                    <Money
                      cents={totals.unpaidCents}
                      tone={totals.unpaidCents > 0 ? 'debt' : undefined}
                    />
                  }
                  note={t.unpaidCount(totals.unpaidCount)}
                />
                <Stat label={t.stats.entries} value={<span data-num>{totals.entryCount}</span>} />
              </dl>
              <p className="text-xs text-muted-foreground">{t.stats.note}</p>
            </div>

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
                value={status}
                onValueChange={(next) => {
                  setStatus(next as StatusFilter);
                }}
              >
                <TabsList aria-label={t.filters.label} className="max-sm:w-full">
                  {STATUSES.map((option) => (
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
                value={category ?? EVERY_CATEGORY}
                onValueChange={(next) => {
                  setCategory(next === EVERY_CATEGORY ? null : next);
                }}
              >
                <SelectTrigger
                  aria-label={t.filters.category}
                  className="order-3 w-40 max-sm:order-2 max-sm:w-36"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EVERY_CATEGORY}>{t.filters.allCategories}</SelectItem>
                  {categories.map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                      {categoryName(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {rows.length === 0 ? (
              <EmptyState
                icon={ReceiptIcon}
                title={t.emptyTitle}
                description={t.emptyDescription}
                action={
                  isOwner ? (
                    <Button variant="outline" onClick={addExpense}>
                      <PlusIcon aria-hidden />
                      {t.add}
                    </Button>
                  ) : undefined
                }
              />
            ) : shown.length === 0 ? (
              <EmptyState
                icon={ReceiptIcon}
                title={t.noMatchTitle}
                description={t.noMatchDescription}
                action={
                  filtering ? (
                    <Button variant="outline" onClick={resetFilters}>
                      {t.showAll}
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ExpenseTable
                rows={shown}
                categoryLabel={categoryLabel}
                canWrite={isOwner}
                lockedThrough={lockedThrough}
                onMarkPaid={markPaid}
                onEdit={setEditing}
                onVoid={(expense) => {
                  setVoiding({ kind: 'expense', id: expense.id });
                }}
              />
            )}
          </div>

          <RecurringPanel
            bills={data.bills}
            categoryLabel={categoryLabel}
            canWrite={isOwner}
            onAdd={() => {
              setEditingTemplate('new');
            }}
            onCreate={setCreating}
            onEdit={setEditingTemplate}
            onToggle={toggleTemplate}
            onVoid={(template) => {
              setVoiding({ kind: 'template', id: template.id });
            }}
          />
        </div>
      )}

      {editing !== null && (
        <ExpenseDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          categories={categories}
          expense={editing === 'new' ? undefined : editing}
          employeeName={
            editing === 'new'
              ? null
              : (rows.find((row) => row.expense.id === editing.id)?.employeeName ?? null)
          }
        />
      )}
      {editingTemplate !== null && (
        <RecurringDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditingTemplate(null);
          }}
          categories={categories}
          template={editingTemplate === 'new' ? undefined : editingTemplate}
        />
      )}
      {creating !== null && (
        <FromTemplateDialog
          bill={creating}
          onOpenChange={(open) => {
            if (!open) setCreating(null);
          }}
        />
      )}
      <VoidDialog
        open={voiding !== null}
        onOpenChange={(open) => {
          if (!open) setVoiding(null);
        }}
        title={voiding?.kind === 'template' ? t.recurring.voidTitle : t.voidTitle}
        description={voiding?.kind === 'template' ? t.recurring.voidDescription : t.voidDescription}
        onConfirm={async (reason) => {
          if (voiding?.kind === 'expense') await repositories.expenses.void(voiding.id, reason);
          if (voiding?.kind === 'template')
            await repositories.expenses.voidTemplate(voiding.id, reason);
          setVoiding(null);
          toast.success(t.voided, { description: messages.forms.saved });
        }}
      />
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="grid content-start gap-0.5 px-3 py-2.5 sm:px-4">
      <dt className="text-xs text-muted-foreground sm:text-sm">{label}</dt>
      <dd className="font-heading text-lg font-semibold sm:text-xl">{value}</dd>
      {note && <dd className="text-xs text-muted-foreground">{note}</dd>}
    </div>
  );
}
