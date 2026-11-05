'use client';

import { useId, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { type ProductBatchView, useRepositories, ValidationError } from '@/local-db';
import { CountInput, MeterInput, WeightInput } from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';

const t = messages.productStock.stockAction;
const issues: Readonly<Record<string, string>> = t.issues;

/** What a batch is counted in: weight while it has no length, pieces, else meters. */
const unitOfBatch = (batch: ProductBatchView): 'kg' | 'meter' | 'piece' =>
  batch.unit === 'piece' ? 'piece' : batch.status === 'pending' ? 'kg' : 'meter';

/**
 * Records damaged stock (a loss, taken off at cost) or a stocktake count (the difference with the
 * books) on one batch. Each is a stock move of its own: nothing is edited, so history and past
 * costs stay as they were. The reason is required (SPEC §2.4).
 */
export function StockActionDialog({
  kind,
  batches,
  initialBatchId,
  onClose,
}: {
  kind: 'loss' | 'count';
  batches: readonly ProductBatchView[];
  initialBatchId?: string;
  onClose: () => void;
}) {
  const id = useId();
  const repositories = useRepositories();
  const [batchId, setBatchId] = useState(initialBatchId ?? batches[0]?.batchId ?? '');
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const batch = batches.find((entry) => entry.batchId === batchId);
  const unit = batch ? unitOfBatch(batch) : 'meter';
  const inputProps = {
    id: `${id}-amount`,
    value: amount,
    onValueChange: (value: number | null) => {
      setAmount(value);
      setErrors({});
    },
  };

  const submit = () => {
    if (!batch) return;
    if (amount === null || (kind === 'loss' && amount < 1)) {
      setErrors({ amount: messages.forms.required });
      return;
    }
    if (reason.trim() === '') {
      setErrors({ reason: t.issues.stock_move_reason_required });
      return;
    }
    setSaving(true);
    const date = shopToday();
    const done =
      kind === 'loss'
        ? repositories.stock.act({
            type: 'loss',
            batchId: batch.batchId,
            date,
            quantity: amount,
            reason: reason.trim(),
          })
        : repositories.stock.act({
            type: 'adjustment',
            batchId: batch.batchId,
            date,
            counted: amount,
            reason: reason.trim(),
          });
    done
      .then(() => {
        toast.success(t.saved);
        onClose();
      })
      .catch((failure: unknown) => {
        setSaving(false);
        if (!(failure instanceof ValidationError)) throw failure;
        const message = failure.issues[0]?.message ?? '';
        setErrors({ amount: issues[message] ?? messages.forms.invalid });
      });
  };

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
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{kind === 'loss' ? t.lossTitle : t.countTitle}</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${id}-batch`}>{t.batch}</FieldLabel>
              <Select
                value={batchId}
                onValueChange={(next) => {
                  setBatchId(next);
                  setAmount(null);
                }}
              >
                <SelectTrigger id={`${id}-batch`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {batches.map((entry) => (
                    <SelectItem key={entry.batchId} value={entry.batchId}>
                      <bdi dir="ltr" data-num>
                        {entry.code}
                      </bdi>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field data-invalid={errors.amount ? true : undefined}>
              <FieldLabel htmlFor={`${id}-amount`}>
                {kind === 'loss' ? t.lossQuantity : t.counted}
              </FieldLabel>
              {unit === 'kg' ? (
                <WeightInput {...inputProps} />
              ) : unit === 'piece' ? (
                <CountInput {...inputProps} />
              ) : (
                <MeterInput {...inputProps} />
              )}
              {errors.amount && <FieldError>{errors.amount}</FieldError>}
            </Field>
            <Field data-invalid={errors.reason ? true : undefined}>
              <FieldLabel htmlFor={`${id}-reason`}>{t.reason}</FieldLabel>
              <Input
                id={`${id}-reason`}
                value={reason}
                placeholder={t.reasonPlaceholder}
                aria-invalid={errors.reason ? true : undefined}
                onChange={(event) => {
                  setReason(event.target.value);
                  setErrors({});
                }}
              />
              {errors.reason && <FieldError>{errors.reason}</FieldError>}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {messages.forms.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" variant="accent" disabled={saving || !batch}>
              {saving ? messages.forms.saving : t.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
