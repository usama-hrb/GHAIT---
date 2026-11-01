'use client';

import { BellIcon } from 'lucide-react';
import { useState } from 'react';
import { messages } from '@/i18n';
import { type ReminderView, useLiveQuery, useRepositories } from '@/local-db';
import { DateText, Money } from '@/shared/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { FromTemplateDialog } from './expense-dialogs';

const t = messages.expenses.reminders;

function StatusBadge({ reminder }: { reminder: ReminderView }) {
  if (reminder.status === 'overdue') return <Badge variant="destructive">{t.overdue}</Badge>;
  if (reminder.status === 'due') return <Badge variant="warning">{t.due}</Badge>;
  return <Badge variant="secondary">{t.upcoming(reminder.daysLeft)}</Badge>;
}

/**
 * Recurring bills to create (SPEC §5 "يذكّر قبل الموعد"): on the home screen and the expenses
 * screen, each with "create" (the amount editable). Renders nothing when there are none.
 */
export function ExpenseReminders({ showEmpty = false }: { showEmpty?: boolean }) {
  const repositories = useRepositories();
  const reminders = useLiveQuery(() => repositories.expenses.reminders(), [repositories]);
  const [creating, setCreating] = useState<ReminderView | null>(null);

  if (reminders === undefined || (reminders.length === 0 && !showEmpty)) return null;
  return (
    <section aria-label={t.title} className="grid gap-2 rounded-xl border bg-card p-4">
      <h3 className="flex items-center gap-2 font-heading font-semibold">
        <BellIcon aria-hidden className="size-4" />
        {t.title}
      </h3>
      {reminders.length === 0 ? (
        <p className="text-muted-foreground">{t.empty}</p>
      ) : (
        <ul className="grid gap-2">
          {reminders.map((reminder) => (
            <li
              key={`${reminder.templateId} ${reminder.month}`}
              className="flex flex-wrap items-center gap-2"
            >
              <span className="font-medium">{reminder.template.name}</span>
              <DateText value={reminder.dueDate} className="text-sm text-muted-foreground" />
              {reminder.template.amountCents !== null && (
                <Money cents={reminder.template.amountCents} />
              )}
              <StatusBadge reminder={reminder} />
              <Button
                size="sm"
                variant="outline"
                className="ms-auto"
                onClick={() => {
                  setCreating(reminder);
                }}
              >
                {t.create}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <FromTemplateDialog
        key={creating ? `${creating.templateId} ${creating.month}` : 'none'}
        reminder={creating}
        onOpenChange={(open) => {
          if (!open) setCreating(null);
        }}
      />
    </section>
  );
}
