'use client';

import { useId, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { type ProductBatchView, useRepositories, ValidationError } from '@/local-db';
import { MeterInput } from '@/shared/format';
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
import { Field, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';

const t = messages.productStock.measureDialog;

const issueText = (message: string | undefined) =>
  (message && messages.productStock.stockAction.issues[message as never]) || messages.forms.invalid;

/**
 * Measures a batch (SPEC §2.3): its whole length, as measured now. A weight received without a
 * length becomes sellable by the meter; an estimate becomes measured. The batch's receipt is not
 * edited: the measurement is a move, and past costs are re-derived from the batch (P9 keeps the
 * ones a settlement froze).
 */
export function MeasureDialog({
  batches,
  initialBatchId,
  onClose,
}: {
  /** The batches that can be measured. */
  batches: readonly ProductBatchView[];
  initialBatchId?: string;
  onClose: () => void;
}) {
  const id = useId();
  const repositories = useRepositories();
  const [batchId, setBatchId] = useState(initialBatchId ?? batches[0]?.batchId ?? '');
  const [lengthCm, setLengthCm] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = () => {
    if (lengthCm === null || lengthCm < 1) {
      setError(messages.forms.required);
      return;
    }
    setSaving(true);
    repositories.productInventory
      .measure(batchId, lengthCm, note.trim() === '' ? null : note.trim())
      .then(() => {
        toast.success(t.saved);
        onClose();
      })
      .catch((failure: unknown) => {
        setSaving(false);
        if (!(failure instanceof ValidationError)) throw failure;
        setError(issueText(failure.issues[0]?.message));
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
            <DialogTitle>{t.title}</DialogTitle>
            <DialogDescription>{t.description}</DialogDescription>
          </DialogHeader>
          {batches.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.nothing}</p>
          ) : (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`${id}-batch`}>{t.batch}</FieldLabel>
                <Select value={batchId} onValueChange={setBatchId}>
                  <SelectTrigger id={`${id}-batch`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {batches.map((batch) => (
                      <SelectItem key={batch.batchId} value={batch.batchId}>
                        <bdi dir="ltr" data-num>
                          {batch.code}
                        </bdi>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field data-invalid={error ? true : undefined}>
                <FieldLabel htmlFor={`${id}-length`}>{t.length}</FieldLabel>
                <MeterInput
                  id={`${id}-length`}
                  value={lengthCm}
                  onValueChange={(cm) => {
                    setLengthCm(cm);
                    setError(null);
                  }}
                />
                {error && <FieldError>{error}</FieldError>}
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-note`}>{t.note}</FieldLabel>
                <Input
                  id={`${id}-note`}
                  value={note}
                  onChange={(event) => {
                    setNote(event.target.value);
                  }}
                />
              </Field>
            </FieldGroup>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {messages.forms.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" variant="accent" disabled={saving || batches.length === 0}>
              {saving ? messages.forms.saving : t.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
