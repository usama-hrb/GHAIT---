'use client';

import { useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { isPeriodLocked, useLiveQuery, useRepositories, ValidationError } from '@/local-db';
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
import type { PayablePurchase } from './supplier-view';

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

/** A purchase as the list of targets names it: when, of what, and what is still due on it. */
function PurchaseLabel({ purchase }: { purchase: PayablePurchase }) {
  return (
    <>
      <DateText value={purchase.date} />
      {purchase.productNames.length > 0 && <> · {purchase.productNames.join('، ')}</>} ·{' '}
      <Money cents={purchase.dueCents} />
    </>
  );
}

/**
 * Pays a supplier part of what the shop owes (SP2, SP3): to the chosen purchase first, then the
 * oldest; never more than is owed. The dialog shows where the money will go and what stays owed;
 * that is the repository's preview, the same core account the save runs, so nothing is worked out
 * here. The save is the one the supplier screens always used (`supplierAccounts.pay`).
 */
export function SupplierPaymentDialog({
  open,
  onOpenChange,
  supplierId,
  owedCents,
  purchases,
  defaultTarget = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierId: string;
  /** What the shop owes the supplier now (the account's). */
  owedCents: number;
  /** The purchases with something still due, oldest first. */
  purchases: readonly PayablePurchase[];
  /** A purchase to pay towards when the dialog opens; the oldest first when none. */
  defaultTarget?: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Mounted while open only: every opening starts empty, and a saved payment cannot be
            saved again by a second click on a form that still holds its amount. */}
        <PaymentForm
          supplierId={supplierId}
          owedCents={owedCents}
          purchases={purchases}
          defaultTarget={defaultTarget}
          onDone={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function PaymentForm({
  supplierId,
  owedCents,
  purchases,
  defaultTarget,
  onDone,
}: {
  supplierId: string;
  owedCents: number;
  purchases: readonly PayablePurchase[];
  defaultTarget: string | null;
  onDone: () => void;
}) {
  const id = useId();
  const repositories = useRepositories();
  const [amount, setAmount] = useState<number | null>(null);
  const [target, setTarget] = useState<string>(
    defaultTarget && purchases.some((purchase) => purchase.purchaseId === defaultTarget)
      ? defaultTarget
      : OLDEST,
  );
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
            supplierId,
            amountCents: amount,
            date,
            method,
            purchaseId: target === OLDEST ? null : target,
            note: note.trim() === '' ? null : note,
          },
    [supplierId, amount, date, method, target, note],
  );
  const preview = useLiveQuery(
    async () => (input ? repositories.supplierAccounts.previewPayment(input) : null),
    [repositories, input],
  );
  const targetPurchase = purchases.find((purchase) => purchase.purchaseId === target);
  const byId = new Map(purchases.map((purchase) => [purchase.purchaseId, purchase]));
  const problem = preview?.issues[0] ? t.issues[preview.issues[0].message] : undefined;

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        // One payment per submit: while it is being saved, a second click does nothing.
        if (!input || busy || preview?.issues.length) return;
        setBusy(true);
        repositories.supplierAccounts
          .pay(input)
          .then(() => {
            toast.success(t.paymentSaved, { description: messages.forms.saved });
            onDone();
          })
          .catch((error: unknown) => {
            toast.error(issueText(error));
            setBusy(false);
          });
      }}
    >
      <DialogHeader>
        <DialogTitle>{t.recordPayment}</DialogTitle>
        <DialogDescription>{t.payDescription}</DialogDescription>
      </DialogHeader>
      <p className="flex items-baseline justify-between gap-2 rounded-md bg-muted px-3 py-2 text-sm">
        <span className="text-muted-foreground">{t.owedNow}</span>
        <Money cents={owedCents} tone="debt" className="text-base font-semibold" />
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
          {owedCents > 0 && (
            <div
              className="flex flex-wrap items-center gap-2"
              role="group"
              aria-label={t.amountShortcuts}
            >
              {targetPurchase && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setAmount(targetPurchase.dueCents);
                  }}
                >
                  {t.thisPurchase} · <Money cents={targetPurchase.dueCents} />
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setAmount(owedCents);
                }}
              >
                {t.allOwed} · <Money cents={owedCents} />
              </Button>
            </div>
          )}
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
                  <PurchaseLabel purchase={purchase} />
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

      {problem ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {problem}
        </p>
      ) : (
        preview && (
          <ul className="grid gap-1 text-sm" aria-live="polite">
            {preview.allocations.map((allocation) => {
              const purchase =
                allocation.purchaseId === null ? undefined : byId.get(allocation.purchaseId);
              return (
                <li
                  key={`${allocation.paymentId}-${allocation.purchaseId ?? 'advance'}`}
                  className="flex justify-between gap-2"
                >
                  <span className="text-muted-foreground">
                    {allocation.purchaseId === null ? (
                      t.advanceKept
                    ) : (
                      <>
                        {t.purchaseOf} {purchase ? <DateText value={purchase.date} /> : null}
                      </>
                    )}
                  </span>
                  <Money cents={allocation.amountCents} />
                </li>
              );
            })}
            <li className="mt-1 flex justify-between gap-2 border-t pt-2 font-semibold">
              <span>{preview.owedAfterCents > 0 ? t.afterPayment : t.paidUp}</span>
              {preview.owedAfterCents > 0 && <Money cents={preview.owedAfterCents} />}
            </li>
          </ul>
        )
      )}

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {messages.forms.cancel}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={busy || Boolean(problem)}>
          {busy ? messages.forms.saving : messages.forms.save}
        </Button>
      </DialogFooter>
    </form>
  );
}
