'use client';

import type { RecurringExpense } from '@fabric/contracts';
import type { NextDue } from '@fabric/core';
import { MoreHorizontalIcon, PlusIcon } from 'lucide-react';
import { messages } from '@/i18n';
import type { Local, TemplateView } from '@/local-db';
import { DateText, Money } from '@/shared/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { dueSoonCount } from './expense-view';
import type { BillToCreate } from './recurring-dialog';

const t = messages.expenses.recurring;
const r = messages.expenses.reminders;

/** How soon the next bill is: overdue and due today stand out, the rest says in how many days. */
function DueBadge({ next }: { next: NextDue }) {
  if (next.status === 'overdue') return <Badge variant="destructive">{r.overdue}</Badge>;
  if (next.status === 'due') return <Badge variant="warning">{r.due}</Badge>;
  return <Badge variant="secondary">{r.upcoming(next.daysLeft)}</Badge>;
}

/**
 * The monthly templates, what is due first on top: each with its category, how often, the amount
 * (or that it varies), when it is next due and how soon, and, for the owner, "Create expense"
 * (the month's expense, never automatic: the amount is confirmed and nothing is paid by itself).
 */
export function RecurringPanel({
  bills,
  categoryLabel,
  canWrite,
  onAdd,
  onCreate,
  onEdit,
  onToggle,
  onVoid,
}: {
  bills: readonly TemplateView[];
  categoryLabel: (key: string) => string;
  canWrite: boolean;
  onAdd: () => void;
  onCreate: (bill: BillToCreate) => void;
  onEdit: (template: Local<RecurringExpense>) => void;
  onToggle: (template: Local<RecurringExpense>) => void;
  onVoid: (template: Local<RecurringExpense>) => void;
}) {
  const soon = dueSoonCount(bills);
  return (
    <section id="recurring" aria-labelledby="recurring-title" className="grid scroll-mt-20 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 id="recurring-title" className="font-heading font-semibold">
            {t.title}
          </h3>
          {bills.length > 0 && (
            <Badge variant={soon > 0 ? 'warning' : 'secondary'}>{t.dueCount(soon)}</Badge>
          )}
        </div>
        {canWrite && bills.length > 0 && (
          <Button size="sm" variant="outline" onClick={onAdd}>
            <PlusIcon aria-hidden />
            {t.add}
          </Button>
        )}
      </div>

      {bills.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-input p-4">
          <p className="font-medium">{t.emptyTitle}</p>
          <p className="text-sm text-muted-foreground">{t.emptyDescription}</p>
          {canWrite && (
            <Button size="sm" variant="outline" onClick={onAdd}>
              <PlusIcon aria-hidden />
              {t.add}
            </Button>
          )}
        </div>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {bills.map(({ template, next }) => (
            <li key={template.id} className="grid gap-2 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="grid min-w-0 gap-0.5">
                  <p className="flex flex-wrap items-center gap-1.5 font-medium">
                    <span className="truncate">{template.name}</span>
                    {!template.active && <Badge variant="outline">{t.paused}</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {categoryLabel(template.category)} · {t.frequency(template.dayOfMonth)}
                  </p>
                </div>
                <span className="shrink-0 font-medium">
                  {template.amountCents === null ? (
                    <span className="text-muted-foreground">{t.variable}</span>
                  ) : (
                    <Money cents={template.amountCents} />
                  )}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                {next ? (
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="text-muted-foreground">{t.nextDue}</span>
                    <DateText value={next.dueDate} />
                    <DueBadge next={next} />
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">{t.noNext}</p>
                )}
                {canWrite && (
                  <div className="ms-auto flex items-center gap-1">
                    {next && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          onCreate({ templateId: template.id, month: next.month, template });
                        }}
                      >
                        {t.create}
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${t.actions}: ${template.name}`}
                        >
                          <MoreHorizontalIcon aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            onEdit(template);
                          }}
                        >
                          {messages.forms.edit}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            onToggle(template);
                          }}
                        >
                          {template.active ? t.pause : t.resume}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => {
                            onVoid(template);
                          }}
                        >
                          {t.voidTitle}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
