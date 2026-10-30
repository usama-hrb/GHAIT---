'use client';

import { normalizeDigits } from '@fabric/core';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { useRepositories, ValidationError } from '@/local-db';
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

const t = messages.customers;

/** Adds a customer quickly (from the POS): a name, and a phone for WhatsApp. Works offline. */
export function CustomerDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (customerId: string) => void;
}) {
  const id = useId();
  const repositories = useRepositories();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [invalid, setInvalid] = useState<'name' | 'phone' | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setName('');
    setPhone('');
    setInvalid(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() === '') {
              setInvalid('name');
              return;
            }
            setBusy(true);
            repositories.customers
              .save({ name, phone: normalizeDigits(phone), notes: null })
              .then((customerId) => {
                toast.success(t.saved, { description: messages.forms.saved });
                reset();
                onSaved(customerId);
                onOpenChange(false);
              })
              .catch((error: unknown) => {
                setInvalid(error instanceof ValidationError ? 'phone' : null);
                if (!(error instanceof ValidationError)) toast.error(messages.forms.invalid);
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.addTitle}</DialogTitle>
            <DialogDescription>{t.addDescription}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={invalid === 'name' || undefined}>
              <FieldLabel htmlFor={`${id}-name`}>{t.name}</FieldLabel>
              <Input
                id={`${id}-name`}
                value={name}
                autoComplete="off"
                aria-invalid={invalid === 'name' || undefined}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
              {invalid === 'name' && <FieldError>{messages.forms.required}</FieldError>}
            </Field>
            <Field data-invalid={invalid === 'phone' || undefined}>
              <FieldLabel htmlFor={`${id}-phone`}>
                {t.phone} <span className="text-muted-foreground">({messages.forms.optional})</span>
              </FieldLabel>
              <Input
                id={`${id}-phone`}
                dir="ltr"
                inputMode="tel"
                value={phone}
                aria-invalid={invalid === 'phone' || undefined}
                onChange={(event) => {
                  setPhone(event.target.value);
                }}
              />
              {invalid === 'phone' && <FieldError>{messages.forms.invalid}</FieldError>}
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
