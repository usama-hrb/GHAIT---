'use client';

import { messages } from '@/i18n';
import type { ExpenseCategory } from '@/local-db';
import { Button } from '@/shared/ui/button';
import { DialogClose, DialogFooter } from '@/shared/ui/dialog';
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from '@/shared/ui/field';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { categoryName } from './category-name';

/** Cancel and Save: Save says it is saving, and cannot be pressed twice. */
export function Footer({ busy }: { busy: boolean }) {
  return (
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
  );
}

export function CategorySelect({
  id,
  value,
  onChange,
  categories,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  categories: readonly ExpenseCategory[];
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {categories.map((category) => (
          <SelectItem key={category.key} value={category.key}>
            {categoryName(category)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Paid or not paid yet, as two choices that say what each means for the books: a paid expense
 * counts in the month of its payment date (S6), an unpaid one when it is paid.
 */
export function PaymentChoice({
  id,
  paid,
  onChange,
  legend,
  paidLabel = messages.expenses.form.paid,
}: {
  id: string;
  paid: boolean;
  onChange: (paid: boolean) => void;
  legend: string;
  paidLabel?: string;
}) {
  const t = messages.expenses.form;
  const options = [
    { value: 'paid', label: paidLabel, hint: t.paidHint },
    { value: 'unpaid', label: t.unpaid, hint: t.unpaidHint },
  ];
  return (
    <RadioGroup
      value={paid ? 'paid' : 'unpaid'}
      aria-label={legend}
      className="grid gap-2 sm:grid-cols-2"
      onValueChange={(value) => {
        onChange(value === 'paid');
      }}
    >
      {options.map((option) => (
        <FieldLabel
          key={option.value}
          htmlFor={`${id}-${option.value}`}
          className="has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
        >
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>{option.label}</FieldTitle>
              <FieldDescription>{option.hint}</FieldDescription>
            </FieldContent>
            <RadioGroupItem value={option.value} id={`${id}-${option.value}`} />
          </Field>
        </FieldLabel>
      ))}
    </RadioGroup>
  );
}
