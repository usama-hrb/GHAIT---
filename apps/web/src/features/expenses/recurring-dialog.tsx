'use client';

import type { RecurringExpense } from '@fabric/contracts';
import { dueDateIn, normalizeDigits } from '@fabric/core';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import {
  type ExpenseCategory,
  isAlreadyCreated,
  isPeriodLocked,
  type Local,
  type ReminderView,
  useRepositories,
} from '@/local-db';
import { DateText, MoneyInput } from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Switch } from '@/shared/ui/switch';
import { CategorySelect, Footer, PaymentChoice } from './form-parts';

const t = messages.expenses;

/** Adds or edits a monthly template: name, category, due day, and a fixed or varying amount. */
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
  const [failed, setFailed] = useState<string | null>(null);
  const dayOfMonth = Number(day);
  const dayValid = Number.isInteger(dayOfMonth) && dayOfMonth >= 1 && dayOfMonth <= 31;
  const nameError = attempted && name.trim() === '';
  const dayError = attempted && !dayValid;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <form
          noValidate
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            setAttempted(true);
            if (busy) return;
            if (name.trim() === '' || !dayValid || (!variable && (amount === null || amount <= 0)))
              return;
            setBusy(true);
            setFailed(null);
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
                setFailed(isPeriodLocked(error) ? messages.forms.periodLocked : t.form.failed);
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
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={nameError || undefined} className="sm:col-span-2">
              <FieldLabel htmlFor={`${id}-name`}>{t.fields.name}</FieldLabel>
              <Input
                id={`${id}-name`}
                value={name}
                autoComplete="off"
                required
                aria-invalid={nameError || undefined}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
              {nameError && <FieldError>{messages.forms.required}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-category`}>{t.fields.category}</FieldLabel>
              <CategorySelect
                id={`${id}-category`}
                value={category}
                onChange={setCategory}
                categories={categories}
              />
            </Field>
            <Field data-invalid={dayError || undefined}>
              <FieldLabel htmlFor={`${id}-day`}>{t.fields.day}</FieldLabel>
              <Input
                id={`${id}-day`}
                inputMode="numeric"
                required
                value={day}
                aria-invalid={dayError || undefined}
                onChange={(event) => {
                  setDay(normalizeDigits(event.target.value).replace(/\D/g, ''));
                }}
              />
              {dayError ? (
                <FieldError>{messages.forms.invalid}</FieldError>
              ) : (
                <FieldDescription>
                  {t.recurring.frequency(dayValid ? dayOfMonth : 1)}
                </FieldDescription>
              )}
            </Field>
            <Field orientation="horizontal" className="sm:col-span-2">
              <Switch id={`${id}-variable`} checked={variable} onCheckedChange={setVariable} />
              <FieldLabel htmlFor={`${id}-variable`}>{t.fields.variable}</FieldLabel>
            </Field>
            {!variable && (
              <Field className="sm:max-w-xs">
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

/** The month's bill a template makes: its template, the month, nothing else. */
export type BillToCreate = Pick<ReminderView, 'templateId' | 'month' | 'template'>;

/**
 * A month's bill from its template in one step (E3): dated on its due date, the amount editable
 * (electricity), paid today or not paid yet. A bill already created for that month is refused (E6).
 */
export function FromTemplateDialog({
  bill,
  onOpenChange,
}: {
  bill: BillToCreate | null;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const repositories = useRepositories();
  const [amount, setAmount] = useState<number | null>(bill?.template.amountCents ?? null);
  const [paidNow, setPaidNow] = useState(true);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  return (
    <Dialog
      open={bill !== null}
      onOpenChange={(next) => {
        if (!next) {
          setAttempted(false);
          setFailed(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <form
          noValidate
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            setAttempted(true);
            if (!bill || busy || amount === null || amount <= 0) return;
            setBusy(true);
            setFailed(null);
            repositories.expenses
              .createFromTemplate({
                templateId: bill.templateId,
                month: bill.month,
                amountCents: amount,
                paidDate: paidNow ? shopToday() : null,
              })
              .then(() => {
                toast.success(t.reminders.created, { description: messages.forms.saved });
                onOpenChange(false);
              })
              .catch((error: unknown) => {
                setFailed(
                  isAlreadyCreated(error)
                    ? t.reminders.alreadyCreated
                    : isPeriodLocked(error)
                      ? messages.forms.periodLocked
                      : t.form.failed,
                );
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t.reminders.createTitle}: {bill?.template.name}
            </DialogTitle>
            <DialogDescription>
              {t.reminders.createDescription}
              {bill && (
                <>
                  {' '}
                  <DateText
                    value={dueDateIn(bill.month, bill.template.dayOfMonth)}
                    className="font-medium text-foreground"
                  />
                </>
              )}
            </DialogDescription>
          </DialogHeader>
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
          <section aria-labelledby={`${id}-payment`} className="grid gap-3">
            <h3 id={`${id}-payment`} className="text-sm font-medium">
              {t.form.paymentTitle}
            </h3>
            <PaymentChoice
              id={id}
              paid={paidNow}
              onChange={setPaidNow}
              legend={t.form.paymentTitle}
              paidLabel={t.reminders.paidToday}
            />
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
