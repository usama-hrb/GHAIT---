'use client';

import type { SupplierPurchaseDue } from '@fabric/core';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { isPeriodLocked, useRepositories, ValidationError } from '@/local-db';
import { DateText, Money, MoneyInput } from '@/shared/format';
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

const t = messages.payables;
const OLDEST = 'oldest';
const METHODS = ['cash', 'bank', 'other'] as const;

const issueText = (error: unknown) => {
  if (isPeriodLocked(error)) return t.issues.period_locked;
  return (
    (error instanceof ValidationError && t.issues[error.issues[0]?.message ?? '']) ||
    messages.forms.invalid
  );
};

/**
 * Pays a supplier part of what the shop owes (BUILD_PROMPTS 5.3, SP3): to a chosen purchase first,
 * else the oldest. Never more than is owed; the money leaves the shop's cash.
 */
export function SupplierPaymentDialog({
  open,
  onOpenChange,
  supplierId,
  owedCents,
  purchases,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierId: string;
  owedCents: number;
  /** The purchases with something still due. */
  purchases: readonly SupplierPurchaseDue[];
}) {
  const id = useId();
  const repositories = useRepositories();
  const [amount, setAmount] = useState<number | null>(null);
  const [target, setTarget] = useState(OLDEST);
  const [method, setMethod] = useState<(typeof METHODS)[number]>('cash');
  const [date, setDate] = useState(() => shopToday());
  const [note, setNote] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);

  const close = (next: boolean) => {
    if (!next) {
      setAmount(null);
      setTarget(OLDEST);
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
            if (amount === null || amount <= 0) return;
            setBusy(true);
            repositories.supplierAccounts
              .pay({
                supplierId,
                amountCents: amount,
                date,
                method,
                purchaseId: target === OLDEST ? null : target,
                note: note.trim() === '' ? null : note,
              })
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
            <DialogTitle>{t.payTitle}</DialogTitle>
            <DialogDescription>{t.payDescription}</DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            <span className="text-muted-foreground">{t.owed}: </span>
            <Money cents={owedCents} tone="debt" />
          </p>
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
                  {purchases.map((purchase) => (
                    <SelectItem key={purchase.purchaseId} value={purchase.purchaseId}>
                      <DateText value={purchase.date} /> · <Money cents={purchase.dueCents} />
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
