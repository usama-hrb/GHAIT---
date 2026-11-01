'use client';

import type { Expense, RecurringExpense } from '@fabric/contracts';
import { normalizeDigits } from '@fabric/core';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import {
  type ExpenseCategory,
  isPeriodLocked,
  type Local,
  type ReminderView,
  useRepositories,
} from '@/local-db';
import { MoneyInput } from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Switch } from '@/shared/ui/switch';
import { PeriodLockHint, useLockedThrough } from '@/features/settlements';
import { categoryName } from './category-name';

const t = messages.expenses;

function Footer({ busy }: { busy: boolean }) {
  return (
    <DialogFooter>
      <DialogClose asChild>
        <Button type="button" variant="outline">
          {messages.forms.cancel}
        </Button>
      </DialogClose>
      <Button type="submit" disabled={busy}>
        {busy ? messages.forms.saving : messages.forms.save}
      </Button>
    </DialogFooter>
  );
}

function CategorySelect({
  id,
  value,
  onChange,
  categories,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  categories: readonly ExpenseCategory[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {categories.map((category) => (
          <SelectItem key={category.key} value={category.key}>
            {categoryName(category)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Adds or edits an expense: date, category, amount, paid or not (SPEC §5). */
export function ExpenseDialog({
  open,
  onOpenChange,
  categories,
  expense,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: readonly ExpenseCategory[];
  expense?: Local<Expense>;
}) {
  const id = useId();
  const repositories = useRepositories();
  const [date, setDate] = useState(() => expense?.date ?? shopToday());
  const [category, setCategory] = useState(expense?.category ?? categories[0]?.key ?? 'other');
  const [amount, setAmount] = useState<number | null>(expense?.amountCents ?? null);
  const [paid, setPaid] = useState(expense ? expense.paidDate !== null : true);
  const [paidDate, setPaidDate] = useState(() => expense?.paidDate ?? shopToday());
  const lockedThrough = useLockedThrough();
  const [note, setNote] = useState(expense?.note ?? '');
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setAttempted(true);
            if (amount === null || amount <= 0) return;
            setBusy(true);
            repositories.expenses
              .save(
                {
                  date,
                  category,
                  amountCents: amount,
                  paidDate: paid ? paidDate : null,
                  note: note.trim() === '' ? null : note,
                  recurringExpenseId: expense?.recurringExpenseId ?? null,
                },
                expense?.id,
              )
              .then(() => {
                toast.success(t.saved, { description: messages.forms.saved });
                onOpenChange(false);
              })
              .catch((error: unknown) => {
                toast.error(
                  isPeriodLocked(error) ? messages.forms.periodLocked : messages.forms.invalid,
                );
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          <DialogHeader>
            <DialogTitle>{expense ? t.edit : t.add}</DialogTitle>
            <DialogDescription>{t.paidInMonthHint}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${id}-category`}>{t.fields.category}</FieldLabel>
                <CategorySelect
                  id={`${id}-category`}
                  value={category}
                  onChange={setCategory}
                  categories={categories}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-amount`}>{t.fields.amount}</FieldLabel>
                <MoneyInput
                  id={`${id}-amount`}
                  required
                  showError={attempted}
                  value={amount}
                  onValueChange={setAmount}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-date`}>{t.fields.date}</FieldLabel>
                <Input
                  id={`${id}-date`}
                  type="date"
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                  }}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-note`}>
                  {t.fields.note}{' '}
                  <span className="text-muted-foreground">({messages.forms.optional})</span>
                </FieldLabel>
                <Input
                  id={`${id}-note`}
                  value={note}
                  onChange={(event) => {
                    setNote(event.target.value);
                  }}
                />
              </Field>
            </div>
            <Field orientation="horizontal">
              <Checkbox
                id={`${id}-paid`}
                checked={paid}
                onCheckedChange={(checked) => {
                  setPaid(checked === true);
                }}
              />
              <FieldLabel htmlFor={`${id}-paid`}>{t.fields.paid}</FieldLabel>
            </Field>
            {paid && (
              <Field>
                <FieldLabel htmlFor={`${id}-paid-date`}>{t.fields.paidDate}</FieldLabel>
                <Input
                  id={`${id}-paid-date`}
                  type="date"
                  value={paidDate}
                  onChange={(event) => {
                    setPaidDate(event.target.value);
                  }}
                />
                <PeriodLockHint date={paidDate} lockedThrough={lockedThrough} />
              </Field>
            )}
          </FieldGroup>
          <Footer busy={busy} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Adds or edits a recurring template: name, category, fixed or variable amount, due day. */
export function RecurringDialog({
  open,
  onOpenChange,
  categories,
  template,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: readonly ExpenseCategory[];
  template?: Local<RecurringExpense>;
}) {
  const id = useId();
  const repositories = useRepositories();
  const [name, setName] = useState(template?.name ?? '');
  const [category, setCategory] = useState(template?.category ?? categories[0]?.key ?? 'other');
  const [variable, setVariable] = useState(template ? template.amountCents === null : false);
  const [amount, setAmount] = useState<number | null>(template?.amountCents ?? null);
  const [day, setDay] = useState(String(template?.dayOfMonth ?? 1));
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const dayOfMonth = Number(day);
  const dayValid = Number.isInteger(dayOfMonth) && dayOfMonth >= 1 && dayOfMonth <= 31;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setAttempted(true);
            if (name.trim() === '' || !dayValid || (!variable && (amount === null || amount <= 0)))
              return;
            setBusy(true);
            repositories.expenses
              .saveTemplate(
                {
                  name,
                  category,
                  amountCents: variable ? null : amount,
                  dayOfMonth,
                  active: template?.active ?? true,
                },
                template?.id,
              )
              .then(() => {
                toast.success(t.recurring.saved, { description: messages.forms.saved });
                onOpenChange(false);
              })
              .catch((error: unknown) => {
                toast.error(
                  isPeriodLocked(error) ? messages.forms.periodLocked : messages.forms.invalid,
                );
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          <DialogHeader>
            <DialogTitle>{template ? t.recurring.edit : t.recurring.add}</DialogTitle>
            <DialogDescription>{t.recurring.description}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={(attempted && name.trim() === '') || undefined}>
              <FieldLabel htmlFor={`${id}-name`}>{t.fields.name}</FieldLabel>
              <Input
                id={`${id}-name`}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${id}-category`}>{t.fields.category}</FieldLabel>
                <CategorySelect
                  id={`${id}-category`}
                  value={category}
                  onChange={setCategory}
                  categories={categories}
                />
              </Field>
              <Field data-invalid={(attempted && !dayValid) || undefined}>
                <FieldLabel htmlFor={`${id}-day`}>{t.fields.day}</FieldLabel>
                <Input
                  id={`${id}-day`}
                  inputMode="numeric"
                  value={day}
                  onChange={(event) => {
                    setDay(normalizeDigits(event.target.value).replace(/\D/g, ''));
                  }}
                />
              </Field>
            </div>
            <Field orientation="horizontal">
              <Switch id={`${id}-variable`} checked={variable} onCheckedChange={setVariable} />
              <FieldLabel htmlFor={`${id}-variable`}>{t.fields.variable}</FieldLabel>
            </Field>
            {!variable && (
              <Field>
                <FieldLabel htmlFor={`${id}-amount`}>{t.fields.amount}</FieldLabel>
                <MoneyInput
                  id={`${id}-amount`}
                  required
                  showError={attempted}
                  value={amount}
                  onValueChange={setAmount}
                />
              </Field>
            )}
          </FieldGroup>
          <Footer busy={busy} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A month's bill from its template in one step; the amount can be changed (electricity). */
export function FromTemplateDialog({
  reminder,
  onOpenChange,
}: {
  reminder: ReminderView | null;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const repositories = useRepositories();
  const [amount, setAmount] = useState<number | null>(reminder?.template.amountCents ?? null);
  const [paidNow, setPaidNow] = useState(true);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog
      open={reminder !== null}
      onOpenChange={(next) => {
        if (!next) setAttempted(false);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setAttempted(true);
            if (!reminder || amount === null || amount <= 0) return;
            setBusy(true);
            repositories.expenses
              .createFromTemplate({
                templateId: reminder.templateId,
                month: reminder.month,
                amountCents: amount,
                paidDate: paidNow ? shopToday() : null,
              })
              .then(() => {
                toast.success(t.reminders.created, { description: messages.forms.saved });
                onOpenChange(false);
              })
              .catch((error: unknown) => {
                toast.error(
                  isPeriodLocked(error) ? messages.forms.periodLocked : messages.forms.invalid,
                );
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t.reminders.createTitle}: {reminder?.template.name}
            </DialogTitle>
            <DialogDescription>{t.reminders.createDescription}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${id}-amount`}>{t.fields.amount}</FieldLabel>
              <MoneyInput
                id={`${id}-amount`}
                required
                showError={attempted}
                value={amount}
                onValueChange={setAmount}
              />
            </Field>
            <Field orientation="horizontal">
              <Checkbox
                id={`${id}-paid`}
                checked={paidNow}
                onCheckedChange={(checked) => {
                  setPaidNow(checked === true);
                }}
              />
              <FieldLabel htmlFor={`${id}-paid`}>{t.reminders.paidNow}</FieldLabel>
            </Field>
          </FieldGroup>
          <Footer busy={busy} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
