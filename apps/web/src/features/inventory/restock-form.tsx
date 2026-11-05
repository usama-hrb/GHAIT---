'use client';

import type { Product } from '@fabric/contracts';
import { averageCostPerMeterCents, isRenewalCostHigher } from '@fabric/core';
import { TriangleAlertIcon } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { type Local, useLiveQuery, useRepositories, ValidationError } from '@/local-db';
import { Money } from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';
import { errorsByField } from '@/shared/lib/form-errors';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Field, FieldError, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import {
  COST_FIELD,
  emptyStockDraft,
  isCostMissing,
  previewOfDraft,
  StockFields,
  type StockDraft,
  stockPurchaseOf,
  totalCostOf,
} from './stock-fields';

const t = messages.productStock;

/** The fields the form shows a message under; any other refusal is shown above the button. */
const FIELD_ERRORS = new Set([
  'quantity',
  COST_FIELD,
  'totalCostCents',
  'conversion',
  'supplierId',
  'paidCents',
  'date',
]);

/**
 * The draft a purchase of this product starts from: the unit it is usually bought in, and for a
 * weight its usual weight to length.
 */
function draftOf(product: Local<Product>, unit?: StockDraft['unit']): StockDraft {
  const usual = product.kgToMeterConversion;
  return {
    ...emptyStockDraft(unit ?? product.purchaseUnits[0] ?? 'meter'),
    ...(usual
      ? {
          conversionKnown: true,
          weightG: usual.weightG,
          lengthCm: usual.lengthCm,
          source: usual.source,
        }
      : {}),
  };
}

/**
 * Buying more of a product (ADR 0012): the one place the restock workflow lives. A purchase of its
 * own, kept as a batch with its own quantity, cost and conversion; earlier batches and their
 * history are never touched. A weight whose cloth length is not known is recorded as awaiting
 * measurement. The dialog of the product list and the panel of the product page both use it.
 */
export function useRestockForm(product: Local<Product>, onSaved?: () => void) {
  const repositories = useRepositories();
  const [draft, setDraft] = useState<StockDraft>(() => draftOf(product));
  const [date, setDate] = useState(() => shopToday());
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // A second Enter or tap before the first save has come back must not buy the stock twice.
  const submittingRef = useRef(false);
  const stock = stockPurchaseOf(draft);
  const totalCents = totalCostOf(draft);

  // SPEC §8.5: a batch dearer per metre than the previous one says the price may need a change.
  const previous = useLiveQuery(
    () => repositories.purchases.lastBatchOf(product.id),
    [repositories, product.id],
  );
  const meters = useMemo(() => previewOfDraft(draft)?.available.meter, [draft]);
  const renewalHigher =
    previous != null &&
    stock !== null &&
    meters?.unit === 'meter' &&
    meters.centimeters > 0 &&
    isRenewalCostHigher(previous, [
      { costTotalCents: stock.totalCostCents, lengthCm: meters.centimeters },
    ]);

  const submit = async () => {
    if (submittingRef.current) return;
    if (!stock || date === '') {
      setErrors({
        ...(draft.quantity === null ? { quantity: messages.forms.required } : {}),
        ...(isCostMissing(draft) ? { [COST_FIELD]: messages.forms.required } : {}),
        ...(draft.conversionKnown && (draft.weightG === null || draft.lengthCm === null)
          ? { conversion: t.form.issues.conversionIncomplete }
          : {}),
        ...(date === '' ? { date: messages.forms.required } : {}),
      });
      return;
    }
    submittingRef.current = true;
    setSaving(true);
    try {
      await repositories.productInventory.restock(product.id, {
        ...stock,
        date,
        notes: note.trim() === '' ? null : note.trim(),
      });
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      setErrors(errorsByField(error.issues, t.form.issues));
      return;
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
    toast.success(t.restock.saved);
    // The next purchase of the same unit from the same supplier is one tap away.
    setDraft((current) => ({ ...draftOf(product, current.unit), supplierId: current.supplierId }));
    setNote('');
    setErrors({});
    onSaved?.();
  };

  return {
    draft,
    date,
    note,
    errors,
    saving,
    totalCents,
    renewal: renewalHigher ? previous : null,
    change: (patch: Partial<StockDraft>) => {
      setDraft((current) => ({ ...current, ...patch }));
      setErrors({});
    },
    setDate: (value: string) => {
      setDate(value);
      setErrors({});
    },
    setNote,
    submit,
    /** Back to the start: nothing typed, the usual unit. */
    clear: () => {
      setDraft(draftOf(product));
      setDate(shopToday());
      setNote('');
      setErrors({});
    },
  };
}

export type RestockForm = ReturnType<typeof useRestockForm>;

/**
 * What a restock asks for: the stock itself (unit, quantity, cost, a weight's conversion, the
 * supplier and what is paid now), the day it was bought, and an optional note. `showTotal` is off
 * where the screen shows the purchase total itself.
 */
export function RestockFields({
  form,
  showTotal = true,
}: {
  form: RestockForm;
  showTotal?: boolean;
}) {
  const id = useId();
  const [noting, setNoting] = useState(form.note !== '');
  const unplaced = Object.entries(form.errors).find(([field]) => !FIELD_ERRORS.has(field))?.[1];

  return (
    <>
      <StockFields
        draft={form.draft}
        onChange={form.change}
        errors={form.errors}
        showPayment
        showTotal={showTotal}
      />
      <Field data-invalid={form.errors.date ? true : undefined}>
        <FieldLabel htmlFor={`${id}-date`}>{t.restock.date}</FieldLabel>
        <Input
          id={`${id}-date`}
          type="date"
          value={form.date}
          aria-invalid={form.errors.date ? true : undefined}
          onChange={(event) => {
            form.setDate(event.target.value);
          }}
        />
        {form.errors.date && <FieldError>{form.errors.date}</FieldError>}
      </Field>
      {noting || form.note !== '' ? (
        <Field>
          <FieldLabel htmlFor={`${id}-note`}>{t.restock.note}</FieldLabel>
          <Input
            id={`${id}-note`}
            value={form.note}
            maxLength={500}
            onChange={(event) => {
              form.setNote(event.target.value);
            }}
          />
        </Field>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="justify-self-start"
          onClick={() => {
            setNoting(true);
          }}
        >
          {t.restock.addNote}
        </Button>
      )}
      {form.renewal && (
        <Alert role="status">
          <TriangleAlertIcon aria-hidden />
          <AlertDescription>
            {t.restock.renewalWarning}{' '}
            <span className="text-muted-foreground">
              ({t.restock.renewalDetail}: <Money cents={averageCostPerMeterCents(form.renewal)} />)
            </span>
          </AlertDescription>
        </Alert>
      )}
      {unplaced && (
        <p role="alert" className="text-sm text-destructive">
          {unplaced}
        </p>
      )}
    </>
  );
}
