'use client';

import { buildStockMove, newStockMoveSchema, rollLedgerOf } from '@fabric/contracts';
import { useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { type RollView, useRepositories, ValidationError } from '@/local-db';
import { Meters, MeterInput, Money } from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';
import { errorsByField } from '@/shared/lib/form-errors';
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
import { Textarea } from '@/shared/ui/textarea';

const t = messages.inventory;

export type StockAction = 'loss' | 'adjustment' | 'length_correction';

const TITLES: Record<StockAction, { title: string; description: string }> = {
  loss: { title: t.dialogs.lossTitle, description: t.dialogs.lossDescription },
  adjustment: { title: t.dialogs.adjustmentTitle, description: t.dialogs.adjustmentDescription },
  length_correction: { title: t.dialogs.measureTitle, description: t.dialogs.measureDescription },
};

/**
 * Loss, stocktake or measurement of one roll. The preview (cost of the loss, the difference,
 * the new cost per metre) comes from the same contract and core functions that record it.
 */
export function StockMoveDialog({
  view,
  action,
  onClose,
}: {
  view: RollView;
  action: StockAction;
  onClose: () => void;
}) {
  const id = useId();
  const repositories = useRepositories();
  const { ledger } = view;
  const [lengthCm, setLengthCm] = useState<number | null>(
    action === 'adjustment' ? Math.max(0, ledger.remainingCm) : null,
  );
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const input = useMemo(() => {
    const date = shopToday();
    const rollId = view.roll.id;
    switch (action) {
      case 'loss':
        return { type: action, rollId, date, lengthCm, reason: text };
      case 'adjustment':
        return { type: action, rollId, date, countedCm: lengthCm, reason: text };
      case 'length_correction':
        return { type: action, rollId, date, measuredRemainingCm: lengthCm, note: text };
    }
  }, [action, lengthCm, text, view.roll.id]);

  const preview = useMemo(() => {
    const parsed = newStockMoveSchema.safeParse({ ...input, reason: 'x', note: null });
    if (!parsed.success) return null;
    const built = buildStockMove(parsed.data, ledger, {
      id: 'preview',
      deviceId: 'preview',
      now: new Date().toISOString(),
    });
    if (!built.ok) return null;
    const after = rollLedgerOf(view.roll, [...view.moves, built.move]);
    return { move: built.move, after };
  }, [input, ledger, view.roll, view.moves]);

  const tooLong = action === 'loss' && lengthCm !== null && lengthCm > ledger.remainingCm;
  const lengthLabel =
    action === 'loss'
      ? t.dialogs.lossLength
      : action === 'adjustment'
        ? t.dialogs.counted
        : t.dialogs.measuredRemaining;
  const lengthField =
    action === 'loss' ? 'lengthCm' : action === 'adjustment' ? 'countedCm' : 'measuredRemainingCm';
  const textField = action === 'length_correction' ? 'note' : 'reason';

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(true);
            if (lengthCm === null || tooLong) return;
            setSaving(true);
            repositories.inventory
              .record(input as Parameters<typeof repositories.inventory.record>[0])
              .then(() => {
                toast.success(t.dialogs.saved, { description: messages.forms.saved });
                onClose();
              })
              .catch((error: unknown) => {
                setSaving(false);
                if (!(error instanceof ValidationError)) throw error;
                setErrors(errorsByField(error.issues, t.issues));
              });
          }}
        >
          <DialogHeader>
            <DialogTitle>{TITLES[action].title}</DialogTitle>
            <DialogDescription>{TITLES[action].description}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={errors[lengthField] || tooLong ? true : undefined}>
              <FieldLabel htmlFor={`${id}-length`}>{lengthLabel}</FieldLabel>
              <MeterInput
                id={`${id}-length`}
                required
                showError={submitted}
                value={lengthCm}
                onValueChange={(cm) => {
                  setLengthCm(cm);
                  setErrors({});
                }}
              />
              {tooLong && <FieldError>{t.dialogs.lossTooLong}</FieldError>}
              {errors[lengthField] && <FieldError>{errors[lengthField]}</FieldError>}
              {preview && action === 'loss' && (
                <FieldDescription>
                  {t.dialogs.lossCost}:{' '}
                  <Money
                    cents={
                      preview.after.costs.find((cost) => cost.id === 'preview')?.costCents ?? 0
                    }
                  />
                </FieldDescription>
              )}
              {preview && action === 'adjustment' && (
                <FieldDescription>
                  {t.dialogs.difference}: <Meters cm={preview.move.deltaCm} />
                </FieldDescription>
              )}
              {preview && action === 'length_correction' && (
                <FieldDescription>
                  {t.dialogs.newTotal}: <Meters cm={preview.after.basisLengthCm} /> ·{' '}
                  {t.dialogs.newCostPerMeter}: <Money cents={preview.after.costPerMeterCents} />
                </FieldDescription>
              )}
            </Field>
            <Field data-invalid={errors[textField] ? true : undefined}>
              <FieldLabel htmlFor={`${id}-text`}>
                {action === 'length_correction' ? t.dialogs.note : t.dialogs.reason}
              </FieldLabel>
              <Textarea
                id={`${id}-text`}
                value={text}
                maxLength={500}
                rows={2}
                onChange={(event) => {
                  setText(event.target.value);
                  setErrors({});
                }}
              />
              {errors[textField] && <FieldError>{errors[textField]}</FieldError>}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {messages.forms.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={saving}>
              {saving ? messages.forms.saving : t.dialogs.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
