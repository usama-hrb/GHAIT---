'use client';

import { ZAKAT_NOTE_MAX, zakatPaymentStateOf } from '@fabric/contracts';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { PeriodLockHint, useLockedThrough } from '@/features/settlements';
import { messages } from '@/i18n';
import { useRepositories } from '@/local-db';
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
import { Fact } from './zakat-ui';
import { zakatErrorText } from './zakat-errors';

const t = messages.zakat;

/** The report a payment is for, as the dialog needs it. */
export interface ZakatPayTarget {
  id: string;
  hawlDate: string;
  zakatDueCents: number;
  paidCents: number;
}

/**
 * Records a zakat payment on a report: an amount that cannot pass what is left, the day it was
 * given and, if the owner wants, a note (a receipt number, who received it). The amount is shared
 * between the partners by ownership as a draw each (Z7), which is not an expense. The payment
 * names itself when the dialog opens, so a second tap or a retry records it once. Mount it afresh
 * for each opening (a `key`), so each payment is its own.
 */
export function ZakatPayDialog({
  report,
  open,
  onOpenChange,
}: {
  report: ZakatPayTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const repositories = useRepositories();
  const lockedThrough = useLockedThrough();
  const status = zakatPaymentStateOf({
    dueCents: report.zakatDueCents,
    paidCents: report.paidCents,
    voided: false,
  });
  const [paymentId] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState<number | null>(status.remainingCents);
  const [date, setDate] = useState(() => shopToday());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const tooMuch = amount !== null && amount > status.remainingCents;
  const valid = amount !== null && amount > 0 && !tooMuch && date !== '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid || busy) return;
            setBusy(true);
            repositories.zakat
              .pay(report.id, {
                amountCents: amount,
                date,
                paymentId,
                note: note.trim() === '' ? null : note.trim(),
              })
              .then(() => {
                toast.success(t.pay.recorded, { description: messages.forms.saved });
                onOpenChange(false);
              })
              .catch((error: unknown) => {
                toast.error(zakatErrorText(error));
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.pay.title}</DialogTitle>
            <DialogDescription>{t.pay.description}</DialogDescription>
          </DialogHeader>
          <dl className="grid gap-2 @container sm:grid-cols-3">
            <Fact label={t.pay.due}>
              <Money cents={status.dueCents} />
            </Fact>
            <Fact label={t.pay.paid}>
              <Money cents={status.paidCents} />
            </Fact>
            <Fact label={t.pay.remaining}>
              <Money cents={status.remainingCents} />
            </Fact>
          </dl>
          <p className="text-sm text-muted-foreground">
            {t.reportOf} <DateText value={report.hawlDate} format="hijri" />
          </p>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${id}-amount`}>{t.fields.amount}</FieldLabel>
                <MoneyInput
                  id={`${id}-amount`}
                  required
                  value={amount}
                  onValueChange={setAmount}
                  aria-invalid={tooMuch}
                />
                {tooMuch && <p className="text-sm text-destructive">{t.pay.aboveRemaining}</p>}
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
                <PeriodLockHint date={date} lockedThrough={lockedThrough} />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor={`${id}-note`}>{t.fields.note}</FieldLabel>
              <Input
                id={`${id}-note`}
                value={note}
                maxLength={ZAKAT_NOTE_MAX}
                placeholder={t.pay.notePlaceholder}
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
            <Button type="submit" disabled={!valid || busy}>
              {busy ? messages.forms.saving : t.actions.pay}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
