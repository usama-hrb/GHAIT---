'use client';

import { formatMoneyAmount, parseMoneyInput } from '@fabric/core';
import { useId } from 'react';
import { messages } from '@/i18n';
import { Keypad, MoneyInput, moneyPad, useMoneyUnit, usePadFields } from '@/shared/format';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Field, FieldLabel } from '@/shared/ui/field';

const t = messages.pos;

/** The invoice discount, typed on the keypad. The total it may not exceed is checked by pricing. */
export function DiscountDialog({
  initial,
  onSubmit,
  onClose,
}: {
  initial: number | null;
  /** null removes the discount. */
  onSubmit: (cents: number | null) => void;
  onClose: () => void;
}) {
  const id = useId();
  const { unit } = useMoneyUnit();
  const pad = usePadFields(
    { amount: initial === null ? '' : formatMoneyAmount(initial, unit, { grouping: false }) },
    { amount: moneyPad(unit) },
    'amount',
  );
  const parsed = parseMoneyInput(pad.texts.amount, unit);
  const cents = parsed.ok ? parsed.value : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[calc(100svh-2rem)] flex-col gap-3 overflow-hidden sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t.fields.discount}</DialogTitle>
          <DialogDescription>{t.bill.discountHint}</DialogDescription>
        </DialogHeader>
        <div className="-mx-4 grid min-h-0 flex-1 content-start gap-3 overflow-y-auto px-4">
          <Field>
            <FieldLabel htmlFor={`${id}-amount`}>{t.fields.discount}</FieldLabel>
            <MoneyInput
              id={`${id}-amount`}
              keypad
              large
              value={cents}
              text={pad.texts.amount}
              onTextChange={(text) => {
                pad.type('amount', text);
              }}
              onFocus={() => {
                pad.activate('amount');
              }}
            />
          </Field>
          <Keypad onPress={pad.press} />
        </div>
        <DialogFooter>
          {initial !== null && (
            <Button
              type="button"
              variant="ghost"
              className="sm:me-auto"
              onClick={() => {
                onSubmit(null);
              }}
            >
              {t.bill.removeDiscount}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose}>
            {messages.forms.cancel}
          </Button>
          <Button
            type="button"
            variant="accent"
            disabled={cents === null}
            onClick={() => {
              onSubmit(cents === null || cents === 0 ? null : cents);
            }}
          >
            {t.bill.applyDiscount}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
