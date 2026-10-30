'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { designMessages as t } from '@/i18n/ar.design';
import { MeterInput, Money, MoneyInput } from '@/shared/format';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Combobox, type ComboboxOption } from '@/shared/ui/combobox';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Switch } from '@/shared/ui/switch';
import { Textarea } from '@/shared/ui/textarea';
import { Section } from './section';

const FABRICS: ComboboxOption[] = t.fabrics.map((label, index) => ({
  value: `fabric-${String(index)}`,
  label,
}));

// MoneyInput/MeterInput report null while empty or invalid (they show their own message).
const requiredInteger = z
  .number()
  .int()
  .positive()
  .nullable()
  .refine((value) => value !== null, { error: t.form.required });

const lineSchema = z.object({
  fabric: z.string({ error: t.form.required }).min(1, t.form.required),
  priceCents: requiredInteger,
  lengthCm: requiredInteger,
  payment: z.enum(['cash', 'credit']),
  belowCost: z.boolean(),
});

type LineForm = z.input<typeof lineSchema>;

/** Form pattern: label above, error below with an icon; integer cents/cm reach the schema. */
function SaleLineForm() {
  const baseId = useId();
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitted },
  } = useForm<LineForm>({
    resolver: zodResolver(lineSchema),
    defaultValues: {
      fabric: '',
      priceCents: null,
      lengthCm: null,
      payment: 'cash',
      belowCost: false,
    },
  });

  return (
    <form
      noValidate
      className="max-w-md rounded-xl border bg-card p-5"
      onSubmit={(event) => {
        void handleSubmit(() => {
          toast.success(t.form.saved);
        })(event);
      }}
    >
      <FieldGroup>
        <Controller
          control={control}
          name="fabric"
          render={({ field }) => (
            <Field data-invalid={errors.fabric ? true : undefined}>
              <FieldLabel htmlFor={`${baseId}-fabric`}>{t.form.fabric}</FieldLabel>
              <Combobox
                id={`${baseId}-fabric`}
                options={FABRICS}
                value={field.value || null}
                onValueChange={(value) => {
                  field.onChange(value ?? '');
                }}
                placeholder={t.form.fabricPlaceholder}
                searchPlaceholder={t.form.fabricSearch}
              />
              {errors.fabric && <FieldError>{errors.fabric.message}</FieldError>}
            </Field>
          )}
        />
        <Controller
          control={control}
          name="priceCents"
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor={`${baseId}-price`}>{t.form.price}</FieldLabel>
              <MoneyInput
                id={`${baseId}-price`}
                required
                showError={isSubmitted}
                value={field.value}
                onValueChange={field.onChange}
                onBlur={field.onBlur}
              />
              <FieldDescription>{t.form.priceHint}</FieldDescription>
            </Field>
          )}
        />
        <Controller
          control={control}
          name="lengthCm"
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor={`${baseId}-length`}>{t.form.length}</FieldLabel>
              <MeterInput
                id={`${baseId}-length`}
                required
                showError={isSubmitted}
                value={field.value}
                onValueChange={field.onChange}
                onBlur={field.onBlur}
              />
              <FieldDescription>{t.form.lengthHint}</FieldDescription>
            </Field>
          )}
        />
        <Controller
          control={control}
          name="payment"
          render={({ field }) => (
            <FieldSet>
              <FieldLegend variant="label">{t.form.payment}</FieldLegend>
              <RadioGroup value={field.value} onValueChange={field.onChange} className="flex gap-6">
                <Field orientation="horizontal">
                  <RadioGroupItem value="cash" id={`${baseId}-cash`} />
                  <FieldLabel htmlFor={`${baseId}-cash`}>{t.form.cash}</FieldLabel>
                </Field>
                <Field orientation="horizontal">
                  <RadioGroupItem value="credit" id={`${baseId}-credit`} />
                  <FieldLabel htmlFor={`${baseId}-credit`}>{t.form.credit}</FieldLabel>
                </Field>
              </RadioGroup>
            </FieldSet>
          )}
        />
        <Controller
          control={control}
          name="belowCost"
          render={({ field }) => (
            <Field orientation="horizontal">
              <Checkbox
                id={`${baseId}-below`}
                checked={field.value}
                onCheckedChange={(checked) => {
                  field.onChange(checked === true);
                }}
              />
              <FieldLabel htmlFor={`${baseId}-below`}>{t.form.belowCost}</FieldLabel>
            </Field>
          )}
        />
        <Button type="submit" variant="accent" size="lg">
          {t.form.submit}
        </Button>
      </FieldGroup>
    </form>
  );
}

export function FormsSection() {
  const baseId = useId();
  const [color, setColor] = useState<string>('');
  const [priceCents, setPriceCents] = useState<number | null>(2050);
  const [lengthCm, setLengthCm] = useState<number | null>(275);

  return (
    <Section id="forms" title={t.sections.forms}>
      <div className="grid gap-8 lg:grid-cols-2">
        <FieldGroup className="max-w-md">
          <Field>
            <FieldLabel htmlFor={`${baseId}-customer`}>{t.form.customer}</FieldLabel>
            <Input id={`${baseId}-customer`} autoComplete="off" />
            <FieldDescription>{t.form.customerHint}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${baseId}-color`}>{t.form.color}</FieldLabel>
            <Select value={color} onValueChange={setColor}>
              <SelectTrigger id={`${baseId}-color`} className="w-full">
                <SelectValue placeholder={t.form.colorPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {t.colors.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${baseId}-note`}>{t.form.note}</FieldLabel>
            <Textarea id={`${baseId}-note`} placeholder={t.form.notePlaceholder} />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${baseId}-money`}>{t.form.price}</FieldLabel>
            <MoneyInput id={`${baseId}-money`} value={priceCents} onValueChange={setPriceCents} />
            <FieldDescription>
              {t.form.valueCents}:{' '}
              <span data-num dir="ltr">
                {priceCents ?? '—'}
              </span>
              {priceCents !== null && (
                <>
                  {' · '}
                  <Money cents={priceCents} unit="dirham" />
                </>
              )}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${baseId}-meters`}>{t.form.length}</FieldLabel>
            <MeterInput id={`${baseId}-meters`} value={lengthCm} onValueChange={setLengthCm} />
            <FieldDescription>
              {t.form.valueCents}:{' '}
              <span data-num dir="ltr">
                {lengthCm ?? '—'}
              </span>
            </FieldDescription>
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor={`${baseId}-share`}>{t.form.share}</FieldLabel>
            </FieldContent>
            <Switch id={`${baseId}-share`} defaultChecked />
          </Field>
        </FieldGroup>
        <SaleLineForm />
      </div>
    </Section>
  );
}
