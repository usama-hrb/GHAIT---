'use client';

import type { Expense } from '@fabric/contracts';
import { monthOf } from '@fabric/core';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { PeriodLockHint, useLockedThrough } from '@/features/settlements';
import { messages } from '@/i18n';
import { type ExpenseCategory, isPeriodLocked, type Local, useRepositories } from '@/local-db';
import { DateText, formatDate, MoneyInput } from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Textarea } from '@/shared/ui/textarea';
import { isFullDate } from './expense-view';
import { CategorySelect, Footer, PaymentChoice } from './form-parts';

const t = messages.expenses;

/**
 * Adds or edits an expense (SPEC §5): what it is (category, amount, its date, a note) and whether
 * it is paid. The payment date is asked only for a paid expense, and says which month it counts in
 * (S6). The fields are the expense's own: nothing is added to what the shop already records.
 */
export function ExpenseDialog({
  open,
  onOpenChange,
  categories,
  expense,
  employeeName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: readonly ExpenseCategory[];
  expense?: Local<Expense>;
  /** Who a salary payment pays (the expense's employee), to say so. */
  employeeName?: string | null;
}) {
  const id = useId();
  const repositories = useRepositories();
  const lockedThrough = useLockedThrough();
  const [date, setDate] = useState(() => expense?.date ?? shopToday());
  const [category, setCategory] = useState(expense?.category ?? categories[0]?.key ?? 'other');
  const [amount, setAmount] = useState<number | null>(expense?.amountCents ?? null);
  const [paid, setPaid] = useState(expense ? expense.paidDate !== null : true);
  const [paidDate, setPaidDate] = useState(() => expense?.paidDate ?? shopToday());
  const [note, setNote] = useState(expense?.note ?? '');
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // A salary payment (ADR 0022) keeps its employee, month and category: they are what payroll
  // counts it by. It is always paid, so the choice is not offered.
  const salary = expense?.employeeId != null && expense.salaryMonth != null;
  const dateError = attempted && !isFullDate(date);
  const paidDateError = attempted && paid && !isFullDate(paidDate);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <form
          noValidate
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            setAttempted(true);
            if (busy) return;
            if (amount === null || amount <= 0 || !isFullDate(date)) return;
            if (paid && !isFullDate(paidDate)) return;
            setBusy(true);
            setFailed(null);
            repositories.expenses
              .save(
                {
                  date,
                  category,
                  amountCents: amount,
                  paidDate: paid ? paidDate : null,
                  note: note.trim() === '' ? null : note,
                  recurringExpenseId: expense?.recurringExpenseId ?? null,
                  employeeId: expense?.employeeId ?? null,
                  salaryMonth: expense?.salaryMonth ?? null,
                },
                expense?.id,
              )
              .then(() => {
                toast.success(t.saved, { description: messages.forms.saved });
                onOpenChange(false);
              })
              .catch((error: unknown) => {
                setFailed(isPeriodLocked(error) ? messages.forms.periodLocked : t.form.failed);
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          <DialogHeader>
            <DialogTitle>{expense ? t.edit : t.add}</DialogTitle>
            <DialogDescription>
              {salary && expense.salaryMonth
                ? t.form.salaryFor(
                    employeeName ?? '',
                    formatDate(`${expense.salaryMonth}-01`, 'month'),
                  )
                : t.form.description}
            </DialogDescription>
          </DialogHeader>

          <section aria-labelledby={`${id}-details`} className="grid gap-3">
            <h3 id={`${id}-details`} className="text-sm font-medium">
              {t.form.detailsTitle}
            </h3>
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor={`${id}-category`}>{t.fields.category}</FieldLabel>
                <CategorySelect
                  id={`${id}-category`}
                  value={category}
                  onChange={setCategory}
                  categories={categories}
                  disabled={salary}
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
              <Field data-invalid={dateError || undefined}>
                <FieldLabel htmlFor={`${id}-date`}>{t.fields.date}</FieldLabel>
                <Input
                  id={`${id}-date`}
                  type="date"
                  required
                  value={date}
                  aria-invalid={dateError || undefined}
                  onChange={(event) => {
                    setDate(event.target.value);
                  }}
                />
                {dateError && <FieldError>{t.form.dateInvalid}</FieldError>}
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor={`${id}-note`}>
                  {t.fields.note}{' '}
                  <span className="font-normal text-muted-foreground">
                    ({messages.forms.optional})
                  </span>
                </FieldLabel>
                <Textarea
                  id={`${id}-note`}
                  rows={2}
                  maxLength={500}
                  value={note}
                  onChange={(event) => {
                    setNote(event.target.value);
                  }}
                />
              </Field>
            </FieldGroup>
          </section>

          <section aria-labelledby={`${id}-payment`} className="grid gap-3 border-t pt-4">
            <h3 id={`${id}-payment`} className="text-sm font-medium">
              {t.form.paymentTitle}
            </h3>
            {!salary && (
              <PaymentChoice id={id} paid={paid} onChange={setPaid} legend={t.form.paymentTitle} />
            )}
            {paid && (
              <Field data-invalid={paidDateError || undefined} className="sm:max-w-xs">
                <FieldLabel htmlFor={`${id}-paid-date`}>{t.form.paidDate}</FieldLabel>
                <Input
                  id={`${id}-paid-date`}
                  type="date"
                  required
                  value={paidDate}
                  aria-invalid={paidDateError || undefined}
                  onChange={(event) => {
                    setPaidDate(event.target.value);
                  }}
                />
                {paidDateError && <FieldError>{t.form.dateInvalid}</FieldError>}
                {isFullDate(paidDate) && (
                  <p className="text-sm text-muted-foreground" aria-live="polite">
                    {t.form.countsIn}{' '}
                    <DateText
                      value={`${monthOf(paidDate)}-01`}
                      format="month"
                      className="font-medium text-foreground"
                    />
                  </p>
                )}
                <PeriodLockHint date={paidDate} lockedThrough={lockedThrough} />
              </Field>
            )}
          </section>

          {failed && (
            <p role="alert" className="text-sm text-destructive">
              {failed}
            </p>
          )}
          <Footer busy={busy} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
