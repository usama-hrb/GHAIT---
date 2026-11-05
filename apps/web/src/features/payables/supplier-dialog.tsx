'use client';

import { normalizeDigits } from '@fabric/core';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { useRepositories, ValidationError } from '@/local-db';
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
import { Field, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Textarea } from '@/shared/ui/textarea';

const t = messages.payables;

/** What editing needs of the supplier being edited. */
export interface EditableSupplier {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
}

/**
 * Adds a supplier, or with `supplier` edits that one: name, phone (for the statement on WhatsApp)
 * and notes. What was bought and paid before is not touched. Works offline.
 */
export function SupplierDialog({
  open,
  onOpenChange,
  onSaved,
  supplier,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (supplierId: string) => void;
  supplier?: EditableSupplier;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Mounted while open only, so every opening starts from the supplier's current data. */}
        <SupplierForm
          supplier={supplier}
          onSaved={onSaved}
          onDone={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function SupplierForm({
  supplier,
  onSaved,
  onDone,
}: {
  supplier: EditableSupplier | undefined;
  onSaved: ((supplierId: string) => void) | undefined;
  onDone: () => void;
}) {
  const id = useId();
  const repositories = useRepositories();
  const [name, setName] = useState(supplier?.name ?? '');
  const [phone, setPhone] = useState(supplier?.phone ?? '');
  const [notes, setNotes] = useState(supplier?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        repositories.suppliers
          // Phones typed with Arabic-Indic digits are stored with Western ones.
          .save({ name, phone: normalizeDigits(phone), notes }, supplier?.id)
          .then((supplierId) => {
            toast.success(t.saved, { description: messages.forms.saved });
            onSaved?.(supplierId);
            onDone();
          })
          .catch((error: unknown) => {
            if (error instanceof ValidationError) setErrors(errorsByField(error.issues));
            else toast.error(messages.forms.invalid);
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <DialogHeader>
        <DialogTitle>{supplier ? t.editTitle : t.addTitle}</DialogTitle>
        <DialogDescription>{supplier ? t.editDescription : t.addDescription}</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor={`${id}-name`}>{t.name}</FieldLabel>
          <Input
            id={`${id}-name`}
            value={name}
            autoComplete="off"
            aria-invalid={errors.name ? true : undefined}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          {errors.name && <FieldError>{errors.name}</FieldError>}
        </Field>
        <Field data-invalid={errors.phone ? true : undefined}>
          <FieldLabel htmlFor={`${id}-phone`}>
            {t.phone} <span className="text-muted-foreground">({messages.forms.optional})</span>
          </FieldLabel>
          <Input
            id={`${id}-phone`}
            type="tel"
            dir="ltr"
            className="text-start"
            value={phone}
            aria-invalid={errors.phone ? true : undefined}
            onChange={(event) => {
              setPhone(event.target.value);
            }}
          />
          {errors.phone && <FieldError>{errors.phone}</FieldError>}
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-notes`}>
            {t.notes} <span className="text-muted-foreground">({messages.forms.optional})</span>
          </FieldLabel>
          <Textarea
            id={`${id}-notes`}
            rows={3}
            maxLength={1000}
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value);
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
        <Button type="submit" disabled={busy}>
          {busy ? messages.forms.saving : messages.forms.save}
        </Button>
      </DialogFooter>
    </form>
  );
}
