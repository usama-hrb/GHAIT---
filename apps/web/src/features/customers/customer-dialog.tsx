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
import { Textarea } from '@/shared/ui/textarea';

const t = messages.customers;

/** What editing needs of the customer being edited. */
export interface EditableCustomer {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
}

/**
 * Adds a customer quickly (from the POS): a name, and a phone for WhatsApp. With `customer` it
 * edits that one instead, notes included; what was sold and paid before is not touched. Works
 * offline.
 */
export function CustomerDialog({
  open,
  onOpenChange,
  onSaved,
  customer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (customerId: string) => void;
  customer?: EditableCustomer;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Mounted while open only, so every opening starts from the customer's current data. */}
        <CustomerForm
          customer={customer}
          onSaved={onSaved}
          onDone={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function CustomerForm({
  customer,
  onSaved,
  onDone,
}: {
  customer: EditableCustomer | undefined;
  onSaved: ((customerId: string) => void) | undefined;
  onDone: () => void;
}) {
  const id = useId();
  const repositories = useRepositories();
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [notes, setNotes] = useState(customer?.notes ?? '');
  const [invalid, setInvalid] = useState<'name' | 'phone' | null>(null);
  const [busy, setBusy] = useState(false);

  return (
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
          .save(
            {
              name,
              phone: normalizeDigits(phone),
              // Quick add has no notes field: an existing customer keeps theirs.
              notes: customer ? (notes.trim() === '' ? null : notes) : null,
            },
            customer?.id,
          )
          .then((customerId) => {
            toast.success(t.saved, { description: messages.forms.saved });
            onSaved?.(customerId);
            onDone();
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
        <DialogTitle>{customer ? t.editTitle : t.addTitle}</DialogTitle>
        <DialogDescription>{customer ? t.editDescription : t.addDescription}</DialogDescription>
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
        {customer && (
          <Field>
            <FieldLabel htmlFor={`${id}-notes`}>
              {t.notes} <span className="text-muted-foreground">({messages.forms.optional})</span>
            </FieldLabel>
            <Textarea
              id={`${id}-notes`}
              rows={3}
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value);
              }}
            />
          </Field>
        )}
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
  );
}
