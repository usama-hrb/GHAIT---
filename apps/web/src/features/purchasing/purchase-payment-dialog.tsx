'use client';

import type { Purchase } from '@fabric/contracts';
import { useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import {
  isPeriodLocked,
  type Local,
  useLiveQuery,
  useRepositories,
  ValidationError,
} from '@/local-db';
import { Money, MoneyInput } from '@/shared/format';
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';

const t = messages.purchasing;

const issueText = (message: string | undefined) =>
  (message !== undefined && t.payment.issues[message]) || messages.forms.invalid;

const errorText = (error: unknown) =>
  isPeriodLocked(error)
    ? t.payment.issues.period_locked
    : error instanceof ValidationError
      ? issueText(error.issues[0]?.message)
      : messages.forms.invalid;

/**
 * Fixes what was paid when a purchase was made (SP9): paid in full by mistake, or only part of it
 * was. The stock, the cost and the date are not touched; what is not paid is owed to the supplier,
 * and a purchase with no supplier takes one here. The preview is the repository's, the same check
 * and account as the save, so nothing is worked out in the dialog.
 */
export function PurchasePaymentDialog({
  purchaseId,
  open,
  onOpenChange,
}: {
  purchaseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Mounted while open only: every opening starts from the purchase as it is now. */}
        <Loaded
          purchaseId={purchaseId}
          onDone={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function Loaded({ purchaseId, onDone }: { purchaseId: string; onDone: () => void }) {
  const repositories = useRepositories();
  const purchase = useLiveQuery(
    async () => (await repositories.purchases.get(purchaseId)) ?? null,
    [repositories, purchaseId],
  );
  if (!purchase) {
    return (
      <DialogHeader>
        <DialogTitle>{t.payment.title}</DialogTitle>
        <DialogDescription>
          {purchase === null ? t.notFound : messages.forms.saving}
        </DialogDescription>
      </DialogHeader>
    );
  }
  return <PaymentForm purchase={purchase} onDone={onDone} />;
}

function PaymentForm({ purchase, onDone }: { purchase: Local<Purchase>; onDone: () => void }) {
  const id = useId();
  const repositories = useRepositories();
  const suppliers = useLiveQuery(() => repositories.suppliers.list(), [repositories]);
  const supplierName = suppliers?.find((supplier) => supplier.id === purchase.supplierId)?.name;
  const total = purchase.totalCostCents;
  const [part, setPart] = useState(purchase.paidCents < total);
  const [amount, setAmount] = useState<number | null>(part ? purchase.paidCents : null);
  const [supplierId, setSupplierId] = useState<string | null>(purchase.supplierId);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);

  const paidCents = part ? amount : total;
  const change = useMemo(
    () => (paidCents === null ? null : { paidCents, supplierId }),
    [paidCents, supplierId],
  );
  const preview = useLiveQuery(
    async () => (change ? repositories.purchases.previewPayment(purchase.id, change) : null),
    [repositories, purchase.id, change],
  );
  const problem = preview?.issues[0] ? issueText(preview.issues[0].message) : undefined;
  const supplierProblem = preview?.issues.some((issue) => issue.path[0] === 'supplierId');
  const unchanged = paidCents === purchase.paidCents && supplierId === purchase.supplierId;

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        // One correction per submit: while it is being saved, a second click does nothing.
        if (!change || busy || unchanged || preview?.issues.length) return;
        setBusy(true);
        repositories.purchases
          .setPayment(purchase.id, change)
          .then(() => {
            toast.success(t.payment.saved, { description: messages.forms.saved });
            onDone();
          })
          .catch((error: unknown) => {
            toast.error(errorText(error));
            setBusy(false);
          });
      }}
    >
      <DialogHeader>
        <DialogTitle>{t.payment.title}</DialogTitle>
        <DialogDescription>{t.payment.description}</DialogDescription>
      </DialogHeader>
      <p className="flex items-baseline justify-between gap-2 rounded-md bg-muted px-3 py-2 text-sm">
        <span className="text-muted-foreground">{t.payment.total}</span>
        <Money cents={total} className="text-base font-semibold" />
      </p>
      <FieldGroup>
        <Field>
          <FieldLabel>{t.payment.howPaid}</FieldLabel>
          <RadioGroup
            value={part ? 'part' : 'full'}
            aria-label={t.payment.howPaid}
            className="flex flex-wrap gap-x-6 gap-y-2"
            onValueChange={(value) => {
              setPart(value === 'part');
              if (value !== 'part') setAmount(null);
            }}
          >
            <Field orientation="horizontal" className="w-auto">
              <RadioGroupItem value="full" id={`${id}-full`} />
              <FieldLabel htmlFor={`${id}-full`}>{t.payment.paidFull}</FieldLabel>
            </Field>
            <Field orientation="horizontal" className="w-auto">
              <RadioGroupItem value="part" id={`${id}-part`} />
              <FieldLabel htmlFor={`${id}-part`}>{t.payment.paidPart}</FieldLabel>
            </Field>
          </RadioGroup>
        </Field>
        {part && (
          <Field data-invalid={(attempted && amount === null) || problem ? true : undefined}>
            <FieldLabel htmlFor={`${id}-amount`}>{t.payment.paidAmount}</FieldLabel>
            <MoneyInput
              id={`${id}-amount`}
              required
              showError={attempted}
              value={amount}
              onValueChange={setAmount}
            />
            {problem && !supplierProblem && <FieldError>{problem}</FieldError>}
          </Field>
        )}
        {purchase.supplierId === null ? (
          <Field data-invalid={supplierProblem ? true : undefined}>
            <FieldLabel htmlFor={`${id}-supplier`}>{t.payment.supplier}</FieldLabel>
            <Select
              value={supplierId ?? 'none'}
              onValueChange={(value) => {
                setSupplierId(value === 'none' ? null : value);
              }}
            >
              <SelectTrigger id={`${id}-supplier`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t.payment.chooseSupplier}</SelectItem>
                {suppliers?.map((supplier) => (
                  <SelectItem key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>{t.payment.supplierHint}</FieldDescription>
            {supplierProblem && problem && <FieldError>{problem}</FieldError>}
          </Field>
        ) : (
          supplierName && (
            <p className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-muted-foreground">{messages.purchasing.fields.supplier}</span>
              <span className="font-medium">{supplierName}</span>
            </p>
          )
        )}
      </FieldGroup>

      {preview && !problem && (
        <ul className="grid gap-1 text-sm" aria-live="polite">
          <li className="flex justify-between gap-2">
            <span className="text-muted-foreground">{t.payment.dueOnPurchase}</span>
            <Money
              cents={preview.purchaseDueCents}
              tone={preview.purchaseDueCents > 0 ? 'debt' : undefined}
            />
          </li>
          {preview.owedCents !== preview.purchaseDueCents && (
            <li className="flex justify-between gap-2 border-t pt-1 font-semibold">
              <span>{t.payment.owedInAll}</span>
              <Money cents={preview.owedCents} tone={preview.owedCents > 0 ? 'debt' : undefined} />
            </li>
          )}
          {preview.advanceCents > 0 && (
            <li className="text-muted-foreground">{t.payment.advanceNote}</li>
          )}
        </ul>
      )}

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {messages.forms.cancel}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={busy || Boolean(problem) || unchanged}>
          {busy ? messages.forms.saving : messages.forms.save}
        </Button>
      </DialogFooter>
    </form>
  );
}
