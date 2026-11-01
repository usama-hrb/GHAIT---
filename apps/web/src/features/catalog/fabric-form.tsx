'use client';

import type { Fabric } from '@fabric/contracts';
import { useId, useMemo } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { messages } from '@/i18n';
import { type Local, useLiveQuery, useRepositories, ValidationError } from '@/local-db';
import { MeterInput, MoneyInput } from '@/shared/format';
import { errorsByField } from '@/shared/lib/form-errors';
import { Button } from '@/shared/ui/button';
import { Combobox } from '@/shared/ui/combobox';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Switch } from '@/shared/ui/switch';
import { Textarea } from '@/shared/ui/textarea';

const t = messages.catalog;

interface FabricFormValues {
  name: string;
  type: string;
  refPricePerMeterCents: number | null;
  minPricePerMeterCents: number | null;
  sellableAsPiece: boolean;
  piecePriceCents: number | null;
  estCmPerKg: number | null;
  defaultSupplierId: string | null;
  tags: string;
  notes: string;
}

function valuesOf(fabric: Local<Fabric> | undefined): FabricFormValues {
  return {
    name: fabric?.name ?? '',
    type: fabric?.type ?? '',
    refPricePerMeterCents: fabric?.refPricePerMeterCents ?? null,
    minPricePerMeterCents: fabric?.minPricePerMeterCents ?? null,
    sellableAsPiece: fabric?.sellableAsPiece ?? false,
    piecePriceCents: fabric?.piecePriceCents ?? null,
    estCmPerKg: fabric?.estCmPerKg ?? null,
    defaultSupplierId: fabric?.defaultSupplierId ?? null,
    tags: fabric?.tags.join(messages.forms.listSeparator) ?? '',
    notes: fabric?.notes ?? '',
  };
}

/** "صيفي، كريب, ناعم" → ['صيفي', 'كريب', 'ناعم']. */
function splitTags(text: string): string[] {
  return text
    .split(/[،,]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/**
 * Add or edit a fabric. Prices are typed in rial or dirham (the money setting) and saved as
 * integer cents; validation is the contract's, the same rules the server applies.
 */
export function FabricForm({
  fabric,
  onSaved,
}: {
  fabric?: Local<Fabric>;
  onSaved: (id: string) => void;
}) {
  const id = useId();
  const repositories = useRepositories();
  const suppliers = useLiveQuery(() => repositories.suppliers.list(), [repositories]);
  const supplierOptions = useMemo(
    () => (suppliers ?? []).map((supplier) => ({ value: supplier.id, label: supplier.name })),
    [suppliers],
  );
  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitted, isSubmitting },
  } = useForm<FabricFormValues>({ defaultValues: valuesOf(fabric) });
  const sellableAsPiece = useWatch({ control, name: 'sellableAsPiece' });

  const submit = handleSubmit(async (values) => {
    try {
      const savedId = await repositories.fabrics.save(
        {
          name: values.name,
          type: values.type,
          refPricePerMeterCents: values.refPricePerMeterCents as number,
          minPricePerMeterCents: values.minPricePerMeterCents as number,
          sellableAsPiece: values.sellableAsPiece,
          piecePriceCents: values.sellableAsPiece ? values.piecePriceCents : null,
          estCmPerKg: values.estCmPerKg,
          defaultSupplierId: values.defaultSupplierId,
          tags: splitTags(values.tags),
          notes: values.notes,
        },
        fabric?.id,
      );
      onSaved(savedId);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      for (const [field, message] of Object.entries(errorsByField(error.issues, t.issues))) {
        setError(field as keyof FabricFormValues, { message });
      }
    }
  });

  /** Money fields show their own "empty" message; only rule errors (min above ref) go below. */
  const moneyError = (field: keyof FabricFormValues, value: number | null) =>
    value !== null ? errors[field]?.message : undefined;

  return (
    <form
      noValidate
      className="grid gap-6 rounded-xl border bg-card p-4 sm:p-6"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <FieldGroup>
        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor={`${id}-name`}>{t.fields.name}</FieldLabel>
          <Input
            id={`${id}-name`}
            placeholder={t.fields.namePlaceholder}
            aria-invalid={errors.name ? true : undefined}
            {...register('name')}
          />
          {errors.name && <FieldError>{errors.name.message}</FieldError>}
        </Field>

        <Field data-invalid={errors.type ? true : undefined}>
          <FieldLabel htmlFor={`${id}-type`}>{t.fields.type}</FieldLabel>
          <Input id={`${id}-type`} placeholder={t.fields.typePlaceholder} {...register('type')} />
          {errors.type && <FieldError>{errors.type.message}</FieldError>}
        </Field>

        <div className="grid gap-6 sm:grid-cols-2">
          <Controller
            control={control}
            name="refPricePerMeterCents"
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor={`${id}-ref`}>{t.fields.refPrice}</FieldLabel>
                <MoneyInput
                  id={`${id}-ref`}
                  required
                  showError={isSubmitted}
                  value={field.value}
                  onValueChange={field.onChange}
                  onBlur={field.onBlur}
                />
                <FieldDescription>{t.fields.refPriceHint}</FieldDescription>
              </Field>
            )}
          />
          <Controller
            control={control}
            name="minPricePerMeterCents"
            render={({ field }) => (
              <Field data-invalid={moneyError(field.name, field.value) ? true : undefined}>
                <FieldLabel htmlFor={`${id}-min`}>{t.fields.minPrice}</FieldLabel>
                <MoneyInput
                  id={`${id}-min`}
                  required
                  showError={isSubmitted}
                  value={field.value}
                  onValueChange={field.onChange}
                  onBlur={field.onBlur}
                />
                <FieldDescription>{t.fields.minPriceHint}</FieldDescription>
                {moneyError(field.name, field.value) && (
                  <FieldError>{moneyError(field.name, field.value)}</FieldError>
                )}
              </Field>
            )}
          />
        </div>

        <Controller
          control={control}
          name="sellableAsPiece"
          render={({ field }) => (
            <Field orientation="horizontal">
              <Switch id={`${id}-piece`} checked={field.value} onCheckedChange={field.onChange} />
              <FieldLabel htmlFor={`${id}-piece`}>{t.fields.sellableAsPiece}</FieldLabel>
            </Field>
          )}
        />
        {sellableAsPiece && (
          <Controller
            control={control}
            name="piecePriceCents"
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor={`${id}-piece-price`}>{t.fields.piecePrice}</FieldLabel>
                <MoneyInput
                  id={`${id}-piece-price`}
                  required
                  showError={isSubmitted}
                  value={field.value}
                  onValueChange={field.onChange}
                  onBlur={field.onBlur}
                />
              </Field>
            )}
          />
        )}

        <div className="grid gap-6 sm:grid-cols-2">
          <Controller
            control={control}
            name="estCmPerKg"
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor={`${id}-kg`}>{t.fields.estPerKg}</FieldLabel>
                <MeterInput
                  id={`${id}-kg`}
                  showError={isSubmitted}
                  value={field.value}
                  onValueChange={field.onChange}
                  onBlur={field.onBlur}
                />
                <FieldDescription>{t.fields.estPerKgHint}</FieldDescription>
              </Field>
            )}
          />
          <Controller
            control={control}
            name="defaultSupplierId"
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor={`${id}-supplier`}>{t.fields.supplier}</FieldLabel>
                <Combobox
                  id={`${id}-supplier`}
                  options={supplierOptions}
                  value={field.value}
                  onValueChange={field.onChange}
                  placeholder={t.fields.supplierPlaceholder}
                />
              </Field>
            )}
          />
        </div>

        <Field>
          <FieldLabel htmlFor={`${id}-tags`}>{t.fields.tags}</FieldLabel>
          <Input id={`${id}-tags`} {...register('tags')} />
          <FieldDescription>{t.fields.tagsHint}</FieldDescription>
        </Field>

        <Field data-invalid={errors.notes ? true : undefined}>
          <FieldLabel htmlFor={`${id}-notes`}>{t.fields.notes}</FieldLabel>
          <Textarea id={`${id}-notes`} maxLength={1000} {...register('notes')} />
          {errors.notes && <FieldError>{errors.notes.message}</FieldError>}
        </Field>
      </FieldGroup>

      <div>
        <Button type="submit" variant="accent" size="lg" disabled={isSubmitting}>
          {isSubmitting ? messages.forms.saving : messages.forms.save}
        </Button>
      </div>
    </form>
  );
}
