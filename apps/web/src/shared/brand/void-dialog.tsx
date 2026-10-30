'use client';

import { useId, useState } from 'react';
import { messages } from '@/i18n';
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
import { Field, FieldError, FieldLabel } from '@/shared/ui/field';
import { Textarea } from '@/shared/ui/textarea';

/** Cancelling a record (never deleting it): asks why, since the reason is kept in the audit log. */
export function VoidDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  confirmLabel = messages.voidDialog.confirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: (reason: string) => Promise<void>;
  /** The confirm button (default: confirm the cancellation). */
  confirmLabel?: string;
}) {
  const id = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReason('');
          setError(false);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (reason.trim() === '') {
              setError(true);
              return;
            }
            setBusy(true);
            void onConfirm(reason.trim()).finally(() => {
              setBusy(false);
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor={`${id}-reason`}>{messages.voidDialog.reason}</FieldLabel>
            <Textarea
              id={`${id}-reason`}
              value={reason}
              placeholder={messages.voidDialog.reasonPlaceholder}
              aria-invalid={error || undefined}
              maxLength={500}
              onChange={(event) => {
                setReason(event.target.value);
                setError(false);
              }}
            />
            {error && <FieldError>{messages.voidDialog.reasonRequired}</FieldError>}
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {messages.forms.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" variant="destructive" disabled={busy}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
