'use client';

import { PeriodLockHint, useLockedThrough } from '@/features/settlements';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { isPeriodLocked, useLiveQuery, useRepositories, ValidationError } from '@/local-db';
import { Money, MoneyInput } from '@/shared/format';
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
import { Field, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';

const t = messages.integrity;

/**
 * A count of the shop's money (SPEC §9, BUILD_PROMPTS 4.4): the till plus the shop's bank
 * account, against what the records say. The difference becomes cash over or short of its
 * period, and needs a reason.
 */
export function CashCountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const repositories = useRepositories();
  const lockedThrough = useLockedThrough();
  const [counted, setCounted] = useState<number | null>(null);
  const [date, setDate] = useState(() => shopToday());
  const [note, setNote] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const expected = useLiveQuery(() => repositories.integrity.expectedCashCents(), [repositories]);
  const diff = counted === null || expected === undefined ? null : counted - expected;
  const needsReason = diff !== null && diff !== 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setAttempted(true);
            if (counted === null || (needsReason && note.trim() === '')) return;
            setBusy(true);
            repositories.integrity
              .recordCount({ date, countedCents: counted, note: note.trim() === '' ? null : note })
              .then(() => {
                toast.success(t.counted, { description: messages.forms.saved });
                onOpenChange(false);
              })
              .catch((error: unknown) => {
                toast.error(
                  isPeriodLocked(error)
                    ? messages.forms.periodLocked
                    : error instanceof ValidationError
                      ? t.reasonRequired
                      : messages.forms.invalid,
                );
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.countTitle}</DialogTitle>
            <DialogDescription>{t.countDescription}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${id}-counted`}>{t.countedLabel}</FieldLabel>
                <MoneyInput
                  id={`${id}-counted`}
                  required
                  showError={attempted}
                  value={counted}
                  onValueChange={setCounted}
                />
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
                <PeriodLockHint date={date} lockedThrough={lockedThrough} />
              </Field>
            </div>
            <dl className="grid gap-1 rounded-lg border p-3 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t.expected}</dt>
                <dd>{expected === undefined ? '…' : <Money cents={expected} />}</dd>
              </div>
              {diff !== null && (
                <div className="flex justify-between gap-2 font-semibold">
                  <dt>{diff === 0 ? t.matches : diff > 0 ? t.over : t.short}</dt>
                  <dd>
                    <Money
                      cents={Math.abs(diff)}
                      tone={diff < 0 ? 'loss' : diff > 0 ? 'profit' : undefined}
                    />
                  </dd>
                </div>
              )}
            </dl>
            <Field data-invalid={(attempted && needsReason && note.trim() === '') || undefined}>
              <FieldLabel htmlFor={`${id}-note`}>
                {t.reason}
                {!needsReason && (
                  <span className="text-muted-foreground"> ({messages.forms.optional})</span>
                )}
              </FieldLabel>
              <Input
                id={`${id}-note`}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
              {attempted && needsReason && note.trim() === '' && (
                <FieldError>{t.reasonRequired}</FieldError>
              )}
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
