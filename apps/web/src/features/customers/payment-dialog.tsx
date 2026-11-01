'use client';

import type { AccountInvoice } from '@fabric/core';
import { useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories, ValidationError } from '@/local-db';
import { formatDate, Money, MoneyInput } from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';
import { Button } from '@/shared/ui/button';
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

const t = messages.customers;
const OLDEST = 'oldest';
const METHODS = ['cash', 'bank', 'other'] as const;

const issueText = (error: unknown) =>
  (error instanceof ValidationError && t.issues[error.issues[0]?.message ?? '']) ||
  messages.forms.invalid;

/**
 * Records a customer's payment, full or partial (BUILD_PROMPTS 3.5): to the chosen invoice first,
 * then the oldest; the dialog shows where the money goes and what stays as credit (P6).
 */
export function PaymentDialog({
  open,
  onOpenChange,
  customerId,
  invoices,
  defaultTarget = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  /** The customer's open invoices (to choose one). */
  invoices: readonly AccountInvoice[];
  defaultTarget?: string | null;
}) {
  const id = useId();
  const repositories = useRepositories();
  const [amount, setAmount] = useState<number | null>(null);
  const [target, setTarget] = useState<string>(defaultTarget ?? OLDEST);
  const [method, setMethod] = useState<(typeof METHODS)[number]>('cash');
  const [date, setDate] = useState(() => shopToday());
  const [note, setNote] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);

  const input = useMemo(
    () =>
      amount === null || amount <= 0
        ? null
        : {
            customerId,
            amountCents: amount,
            date,
            method,
            targetSaleId: target === OLDEST ? null : target,
            note: note.trim() === '' ? null : note,
          },
    [customerId, amount, date, method, target, note],
  );
  const preview = useLiveQuery(
    async () => (input ? repositories.accounts.previewPayment(input) : null),
    [repositories, input],
  );
  const dateOf = new Map(invoices.map((invoice) => [invoice.saleId, invoice.date]));

  const close = (next: boolean) => {
    if (!next) {
      setAmount(null);
      setTarget(defaultTarget ?? OLDEST);
      setNote('');
      setAttempted(false);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setAttempted(true);
            if (!input) return;
            setBusy(true);
            repositories.accounts
              .recordPayment(input)
              .then(() => {
                toast.success(t.paymentSaved, { description: messages.forms.saved });
                close(false);
              })
              .catch((error: unknown) => {
                toast.error(issueText(error));
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.recordPayment}</DialogTitle>
            <DialogDescription>{t.paymentDescription}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${id}-amount`}>{t.amount}</FieldLabel>
              <MoneyInput
                id={`${id}-amount`}
                required
                showError={attempted}
                value={amount}
                onValueChange={setAmount}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-target`}>{t.target}</FieldLabel>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger id={`${id}-target`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={OLDEST}>{t.targetOldest}</SelectItem>
                  {invoices.map((invoice) => (
                    <SelectItem key={invoice.saleId} value={invoice.saleId}>
                      {t.invoiceOf} {formatDate(invoice.date)} · <Money cents={invoice.dueCents} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${id}-method`}>{t.method}</FieldLabel>
                <Select
                  value={method}
                  onValueChange={(next) => {
                    setMethod(next as (typeof METHODS)[number]);
                  }}
                >
                  <SelectTrigger id={`${id}-method`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {METHODS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {t.methods[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-date`}>{t.date}</FieldLabel>
                <Input
                  id={`${id}-date`}
                  type="date"
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                  }}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor={`${id}-note`}>
                {t.note} <span className="text-muted-foreground">({messages.forms.optional})</span>
              </FieldLabel>
              <Input
                id={`${id}-note`}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
            </Field>
          </FieldGroup>

          {preview && (
            <ul className="grid gap-1 text-sm" aria-live="polite">
              {preview.allocations.map((allocation) => (
                <li key={allocation.saleId} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">
                    {t.invoiceOf} {formatDate(dateOf.get(allocation.saleId) ?? date)}
                  </span>
                  <Money cents={allocation.amountCents} />
                </li>
              ))}
              {preview.unappliedCents > 0 && (
                <li className="flex justify-between gap-2 font-medium">
                  <span>{t.creditLeft}</span>
                  <Money cents={preview.unappliedCents} tone="capital" />
                </li>
              )}
            </ul>
          )}

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
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Gives money back out of the customer's credit; never more than it. */
export function RefundDialog({
  open,
  onOpenChange,
  customerId,
  creditCents,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  creditCents: number;
}) {
  const id = useId();
  const repositories = useRepositories();
  const [amount, setAmount] = useState<number | null>(creditCents);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setAmount(creditCents);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (amount === null || amount <= 0) return;
            setBusy(true);
            repositories.accounts
              .refund({ customerId, amountCents: amount, date: shopToday() })
              .then(() => {
                toast.success(t.refundSaved, { description: messages.forms.saved });
                onOpenChange(false);
              })
              .catch((error: unknown) => {
                toast.error(issueText(error));
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.refund}</DialogTitle>
            <DialogDescription>{t.refundDescription}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={`${id}-amount`}>{t.amount}</FieldLabel>
            <MoneyInput id={`${id}-amount`} required value={amount} onValueChange={setAmount} />
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {messages.forms.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? messages.forms.saving : t.refund}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
