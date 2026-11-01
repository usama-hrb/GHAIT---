'use client';

import type { Expense, RecurringExpense } from '@fabric/contracts';
import { monthOf, nextMonth, previousMonth } from '@fabric/core';
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, ReceiptIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { type Local, useLiveQuery, useRepositories } from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice, VoidDialog } from '@/shared/brand';
import { DateText, Money } from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { categoryName } from './category-name';
import { ExpenseDialog, RecurringDialog } from './expense-dialogs';
import { ExpenseReminders } from './reminders';
import { isLockedOn, LockedBadge, useLockedThrough } from '@/features/settlements';

const t = messages.expenses;

/**
 * Expenses (SPEC §5, BUILD_PROMPTS 4.1): a month's bills and what was paid in it, the recurring
 * templates and their reminders. Everything is saved on the device first.
 */
export function ExpensesScreen() {
  const repositories = useRepositories();
  const [month, setMonth] = useState(() => monthOf(shopToday()));
  const [editing, setEditing] = useState<Local<Expense> | 'new' | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<Local<RecurringExpense> | 'new' | null>(
    null,
  );
  const [voiding, setVoiding] = useState<{ kind: 'expense' | 'template'; id: string } | null>(null);
  const lockedThrough = useLockedThrough();
  const data = useLiveQuery(async () => {
    const [view, categories, templates] = await Promise.all([
      repositories.expenses.month(month),
      repositories.expenses.categories(),
      repositories.expenses.recurring(),
    ]);
    return { view, categories, templates };
  }, [repositories, month]);

  if (data === undefined) return <LoadingState />;
  const { view, categories, templates } = data;
  const label = (key: string) => {
    const category = categories.find((found) => found.key === key);
    return category ? categoryName(category) : key;
  };

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4">
      <OfflineNotice />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-xl font-semibold">{t.title}</h2>
        <Button
          variant="accent"
          onClick={() => {
            setEditing('new');
          }}
        >
          <PlusIcon aria-hidden />
          {t.add}
        </Button>
      </div>

      <ExpenseReminders />

      <div className="flex items-center gap-2">
        <Button
          size="icon"
          variant="outline"
          aria-label={t.previousMonth}
          onClick={() => {
            setMonth(previousMonth(month));
          }}
        >
          <ChevronLeftIcon className="rtl:rotate-180" aria-hidden />
        </Button>
        <DateText
          value={`${month}-01`}
          format="month"
          className="min-w-32 text-center font-medium"
        />
        <Button
          size="icon"
          variant="outline"
          aria-label={t.nextMonth}
          onClick={() => {
            setMonth(nextMonth(month));
          }}
        >
          <ChevronRightIcon className="rtl:rotate-180" aria-hidden />
        </Button>
      </div>

      <dl className="grid gap-x-6 gap-y-2 rounded-lg border bg-card p-4 sm:grid-cols-2">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{t.paidInMonth}</dt>
          <dd className="font-semibold">
            <Money cents={view.totals.paidCents} />
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{t.unpaid}</dt>
          <dd>
            <Money
              cents={view.totals.unpaidCents}
              tone={view.totals.unpaidCents > 0 ? 'debt' : undefined}
            />{' '}
            <span className="text-sm text-muted-foreground">
              ({t.unpaidCount(view.totals.unpaidCount)})
            </span>
          </dd>
        </div>
        {Object.entries(view.totals.paidByCategory).map(([key, cents]) => (
          <div key={key} className="flex justify-between gap-2 text-sm">
            <dt className="text-muted-foreground">{label(key)}</dt>
            <dd>
              <Money cents={cents} />
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted-foreground">{t.paidInMonthHint}</p>

      {view.expenses.length === 0 ? (
        <EmptyState icon={ReceiptIcon} title={t.emptyTitle} description={t.emptyDescription} />
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.columns.date}</TableHead>
                <TableHead>{t.columns.category}</TableHead>
                <TableHead className="max-sm:hidden">{t.columns.note}</TableHead>
                <TableHead className="text-end">{t.columns.amount}</TableHead>
                <TableHead>{t.columns.status}</TableHead>
                <TableHead>
                  <span className="sr-only">{messages.forms.edit}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.expenses.map((expense) => (
                <TableRow key={expense.id} className="h-12">
                  <TableCell>
                    <DateText value={expense.date} />
                  </TableCell>
                  <TableCell>{label(expense.category)}</TableCell>
                  <TableCell className="max-sm:hidden text-muted-foreground">
                    {expense.note}
                  </TableCell>
                  <TableCell className="text-end">
                    <Money cents={expense.amountCents} />
                  </TableCell>
                  <TableCell>
                    {expense.paidDate ? (
                      <Badge variant="success">
                        {t.paidOn} <DateText value={expense.paidDate} format="short" />
                      </Badge>
                    ) : (
                      <Badge variant="warning">{t.notPaid}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-end whitespace-nowrap">
                    {expense.paidDate === null && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void repositories.expenses
                            .setPaid(expense.id, shopToday())
                            .then(() =>
                              toast.success(t.markedPaid, { description: messages.forms.saved }),
                            );
                        }}
                      >
                        {t.markPaid}
                      </Button>
                    )}
                    {isLockedOn(expense.paidDate, lockedThrough) ? (
                      <LockedBadge lockedThrough={lockedThrough} />
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(expense);
                          }}
                        >
                          {messages.forms.edit}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setVoiding({ kind: 'expense', id: expense.id });
                          }}
                        >
                          {t.voidTitle}
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <section aria-label={t.recurring.title} className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-heading font-semibold">{t.recurring.title}</h3>
          <Button
            variant="outline"
            onClick={() => {
              setEditingTemplate('new');
            }}
          >
            <PlusIcon aria-hidden />
            {t.recurring.add}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">{t.recurring.description}</p>
        {templates.length === 0 ? (
          <p className="text-muted-foreground">{t.recurring.empty}</p>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.columns.name}</TableHead>
                  <TableHead className="max-sm:hidden">{t.columns.category}</TableHead>
                  <TableHead className="text-end">{t.columns.amount}</TableHead>
                  <TableHead>{t.columns.day}</TableHead>
                  <TableHead>
                    <span className="sr-only">{messages.forms.edit}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((template) => (
                  <TableRow key={template.id} className="h-12">
                    <TableCell>
                      {template.name}
                      {!template.active && (
                        <Badge variant="outline" className="ms-1.5">
                          {t.recurring.paused}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-sm:hidden">{label(template.category)}</TableCell>
                    <TableCell className="text-end">
                      {template.amountCents === null ? (
                        t.recurring.variable
                      ) : (
                        <Money cents={template.amountCents} />
                      )}
                    </TableCell>
                    <TableCell>{t.recurring.dayOf(template.dayOfMonth)}</TableCell>
                    <TableCell className="text-end whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
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
                        }}
                      >
                        {template.active ? t.recurring.pause : t.recurring.resume}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingTemplate(template);
                        }}
                      >
                        {messages.forms.edit}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setVoiding({ kind: 'template', id: template.id });
                        }}
                      >
                        {t.recurring.voidTitle}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {editing !== null && (
        <ExpenseDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          categories={categories}
          expense={editing === 'new' ? undefined : editing}
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
