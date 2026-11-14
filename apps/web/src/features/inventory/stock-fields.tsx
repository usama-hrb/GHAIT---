'use client';

import {
  enabledStockUnits,
  newProductPurchaseSchema,
  PRODUCT_UNITS,
  previewProductPurchase,
  type ProductUnit,
} from '@fabric/contracts';
import {
  meterPurchaseCostCents,
  piecePurchaseCostCents,
  weightPurchaseCostCents,
} from '@fabric/core';
import { InfoIcon } from 'lucide-react';
import { useEffect, useId, useMemo } from 'react';
import { useSellingUnits } from '@/features/settings';
import { messages } from '@/i18n';
import { type StockPurchase, useLiveQuery, useRepositories } from '@/local-db';
import { CountInput, MeterInput, Meters, Money, MoneyInput, WeightInput } from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Switch } from '@/shared/ui/switch';

const t = messages.productStock;

/** What the purchase form holds while it is being filled in. */
export interface StockDraft {
  unit: ProductUnit;
  /** In g, cm or pieces, by `unit`. */
  quantity: number | null;
  /**
   * What one unit cost, as typed: a metre, a kilo or a piece, by `unit`. The cost of the whole
   * purchase is worked out from it and the quantity, never typed.
   */
  unitCostCents: number | null;
  /** A weight only: how much cloth it makes is known. */
  conversionKnown: boolean;
  weightG: number | null;
  lengthCm: number | null;
  source: 'estimated' | 'measured';
  supplierId: string | null;
  /**
   * How the purchase was paid: all of it (the default), or only part, the rest staying owed to the
   * supplier. An explicit choice, never an empty field read as "all".
   */
  partPayment: boolean;
  /** What was paid, when only part of it was. */
  paidCents: number | null;
}

export const emptyStockDraft = (unit: ProductUnit = 'meter'): StockDraft => ({
  unit,
  quantity: null,
  unitCostCents: null,
  conversionKnown: false,
  weightG: null,
  lengthCm: null,
  source: 'measured',
  supplierId: null,
  partPayment: false,
  paidCents: null,
});

/** The key a missing cost is reported under (the form shows it under the cost field). */
export const COST_FIELD = 'unitCostCents';

/** The cost has not been typed yet. */
export const isCostMissing = (draft: StockDraft) => draft.unitCostCents === null;

/** "Paid part" is chosen and what was paid has not been typed yet. */
export const isPaidMissing = (draft: StockDraft) => draft.partPayment && draft.paidCents === null;

/**
 * The cost of the whole purchase, or null while it cannot be known. Every unit is bought at a
 * price per unit: the total is that price times the quantity, worked out by core (SPEC §2.3,
 * PB19, PB21): rounded half up for a length and a weight, exact for pieces.
 */
export function totalCostOf(draft: StockDraft): number | null {
  if (draft.unitCostCents === null || draft.quantity === null || draft.quantity < 1) return null;
  switch (draft.unit) {
    case 'meter':
      return meterPurchaseCostCents(draft.unitCostCents, draft.quantity);
    case 'kg':
      return weightPurchaseCostCents(draft.unitCostCents, draft.quantity);
    case 'piece':
      return piecePurchaseCostCents(draft.unitCostCents, draft.quantity);
  }
}

/** What is bought, without how it is paid: null while the quantity or the cost is incomplete. */
function stockBodyOf(draft: StockDraft): Omit<StockPurchase, 'paidCents'> | null {
  const totalCostCents = totalCostOf(draft);
  if (draft.quantity === null || draft.quantity < 1 || totalCostCents === null) return null;
  const base = {
    unit: draft.unit,
    quantity: draft.quantity,
    totalCostCents,
    supplierId: draft.supplierId,
  };
  if (draft.unit !== 'kg' || !draft.conversionKnown) return base;
  if (draft.weightG === null || draft.lengthCm === null) return null;
  return {
    ...base,
    conversion: { weightG: draft.weightG, lengthCm: draft.lengthCm, source: draft.source },
  };
}

/**
 * The purchase the draft stands for, or null while it is incomplete. All of it is paid unless
 * "paid part" was chosen, and then what was paid must be typed.
 */
export function stockPurchaseOf(draft: StockDraft): StockPurchase | null {
  const body = stockBodyOf(draft);
  if (!body || isPaidMissing(draft)) return null;
  return { ...body, paidCents: draft.partPayment ? draft.paidCents : null };
}

/** A uuid that stands for the product while a purchase is only previewed. */
const PREVIEW_PRODUCT = '00000000-0000-4000-8000-000000000000';

/** What the purchase would bring in, as the ledger reads it (core), before anything is saved. */
export function previewOfDraft(draft: StockDraft) {
  const stock = stockBodyOf(draft);
  if (!stock) return null;
  const parsed = newProductPurchaseSchema.safeParse({
    date: shopToday(),
    productId: PREVIEW_PRODUCT,
    unit: stock.unit,
    quantity: stock.quantity,
    totalCostCents: stock.totalCostCents,
    conversion: stock.conversion ?? null,
  });
  if (!parsed.success) return null;
  try {
    return previewProductPurchase(parsed.data);
  } catch {
    return null;
  }
}

/** The preview of the purchase being typed. */
function StockPreview({ draft, showTotal }: { draft: StockDraft; showTotal: boolean }) {
  const ledger = useMemo(() => previewOfDraft(draft), [draft]);
  if (!ledger) return null;

  const meters = ledger.available.meter;
  const centimeters = meters?.unit === 'meter' ? meters.centimeters : 0;
  const perMeter = ledger.costPerUnitCents.meter;
  // The purchase is bought at the unit price typed above: what the preview adds is the total.
  const total = showTotal ? totalCostOf(draft) : null;
  const perPiece = ledger.costPerUnitCents.piece;
  return (
    <div className="grid gap-1 rounded-lg bg-muted p-3 text-sm" role="status">
      <span className="text-muted-foreground">{t.stock.preview.title}</span>
      {ledger.measurementStatus === 'pending' ? (
        <span className="font-medium">{t.stock.preview.awaiting}</span>
      ) : centimeters > 0 ? (
        <>
          <span className="text-lg font-semibold">
            <Meters cm={centimeters} /> {t.stock.preview.meters}
          </span>
          {total !== null ? (
            <span className="text-muted-foreground">
              {t.stock.preview.totalCost}: <Money cents={total} />
            </span>
          ) : (
            perMeter !== undefined && (
              <span className="text-muted-foreground">
                {t.stock.preview.costPerMeter}: <Money cents={perMeter} />
              </span>
            )
          )}
        </>
      ) : (
        perPiece !== undefined && (
          <span className="text-muted-foreground">
            {t.stock.preview.costPerPiece}: <Money cents={perPiece} />
          </span>
        )
      )}
    </div>
  );
}

/** What was paid when only part of the purchase was, and what that leaves owed to the supplier. */
function PartPayment({
  draft,
  onChange,
  error,
  inputId,
}: {
  draft: StockDraft;
  onChange: (patch: Partial<StockDraft>) => void;
  error: string | undefined;
  inputId: string;
}) {
  const total = totalCostOf(draft);
  const owed = total !== null && draft.paidCents !== null ? total - draft.paidCents : null;
  const above = owed !== null && owed < 0;
  const problem =
    error ?? (above ? messages.productStock.form.issues.purchase_paid_above_total : '');
  return (
    <Field data-invalid={problem ? true : undefined}>
      <FieldLabel htmlFor={inputId}>{t.stock.paidAmount}</FieldLabel>
      <MoneyInput
        id={inputId}
        value={draft.paidCents}
        onValueChange={(paidCents) => {
          onChange({ paidCents });
        }}
      />
      {owed !== null && owed >= 0 && (
        <p
          className="flex items-baseline justify-between gap-2 rounded-md bg-muted px-3 py-2 text-sm"
          role="status"
        >
          <span className="text-muted-foreground">{t.stock.owedRest}</span>
          <Money cents={owed} tone={owed > 0 ? 'debt' : undefined} className="font-semibold" />
        </p>
      )}
      {problem && <FieldError>{problem}</FieldError>}
    </Field>
  );
}

/**
 * The stock of a purchase: what it was bought in and how much, what it cost, and for a weight how
 * much cloth it makes (or that this is not known yet: it then waits for a measurement and no
 * meters are made up). The same fields create a product's first stock and restock it.
 */
export function StockFields({
  draft,
  onChange,
  errors,
  showPayment = false,
  showTotal = true,
  units,
}: {
  draft: StockDraft;
  onChange: (patch: Partial<StockDraft>) => void;
  errors: Readonly<Record<string, string>>;
  /** Restocking also records the supplier and what was paid now. */
  showPayment?: boolean;
  /** The preview names the total of a length bought: off where the screen shows the total itself. */
  showTotal?: boolean;
  /** The units offered; by default the ones the shop works in (ADR 0023). */
  units?: readonly ProductUnit[];
}) {
  const id = useId();
  const shopUnits = useSellingUnits();
  const offered = units ?? enabledStockUnits(shopUnits);
  const first = offered[0];
  const offersDraftUnit = offered.includes(draft.unit);
  useEffect(() => {
    // A draft can start in a unit the shop no longer uses (the usual unit of an older product):
    // it moves to one it does, with nothing typed, since a quantity or a price means a unit.
    if (first !== undefined && !offersDraftUnit) {
      onChange({ unit: first, quantity: null, unitCostCents: null });
    }
  }, [first, offersDraftUnit, onChange]);
  const repositories = useRepositories();
  const suppliers = useLiveQuery(() => repositories.suppliers.list(), [repositories]);
  const costError = errors[COST_FIELD] ?? errors.totalCostCents;
  const quantityProps = {
    id: `${id}-quantity`,
    value: draft.quantity,
    onValueChange: (quantity: number | null) => {
      onChange({ quantity });
    },
  };

  return (
    <FieldGroup>
      <Field>
        <FieldLabel>{t.stock.unit}</FieldLabel>
        <RadioGroup
          value={draft.unit}
          aria-label={t.stock.unit}
          className="flex flex-wrap gap-x-6 gap-y-2"
          onValueChange={(value) => {
            const next = PRODUCT_UNITS.find((unit) => unit === value);
            // Another unit is another quantity and another price: the old figures would mean
            // something else (a price per metre is not a price per kilo).
            if (next) onChange({ unit: next, quantity: null, unitCostCents: null });
          }}
        >
          {offered.map((unit) => (
            <Field key={unit} orientation="horizontal" className="w-auto">
              <RadioGroupItem value={unit} id={`${id}-unit-${unit}`} />
              <FieldLabel htmlFor={`${id}-unit-${unit}`}>{t.units[unit]}</FieldLabel>
            </Field>
          ))}
        </RadioGroup>
      </Field>

      {/* Two columns when the form has the room, whatever the screen: it sits in a dialog or a side panel. */}
      <div className="@container">
        <div className="grid gap-4 @xs:grid-cols-2">
          <Field data-invalid={errors.quantity ? true : undefined}>
            <FieldLabel htmlFor={`${id}-quantity`}>{t.stock.quantity[draft.unit]}</FieldLabel>
            {draft.unit === 'kg' ? (
              <WeightInput {...quantityProps} />
            ) : draft.unit === 'meter' ? (
              <MeterInput {...quantityProps} />
            ) : (
              <CountInput {...quantityProps} />
            )}
            {errors.quantity && <FieldError>{errors.quantity}</FieldError>}
          </Field>
          <Field data-invalid={costError ? true : undefined}>
            <FieldLabel htmlFor={`${id}-cost`}>{t.stock.unitCost[draft.unit]}</FieldLabel>
            <MoneyInput
              id={`${id}-cost`}
              value={draft.unitCostCents}
              onValueChange={(unitCostCents) => {
                onChange({ unitCostCents });
              }}
            />
            <FieldDescription>{t.stock.unitCostHint}</FieldDescription>
            {costError && <FieldError>{costError}</FieldError>}
          </Field>
        </div>
      </div>

      {draft.unit === 'kg' && (
        <>
          <Field orientation="horizontal">
            <Switch
              id={`${id}-known`}
              checked={draft.conversionKnown}
              onCheckedChange={(conversionKnown) => {
                onChange({ conversionKnown });
              }}
            />
            <FieldLabel htmlFor={`${id}-known`}>{t.stock.conversionToggle}</FieldLabel>
          </Field>
          {draft.conversionKnown ? (
            <>
              <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                <Field>
                  <FieldLabel htmlFor={`${id}-weight`}>{t.form.weight}</FieldLabel>
                  <WeightInput
                    id={`${id}-weight`}
                    value={draft.weightG}
                    onValueChange={(weightG) => {
                      onChange({ weightG });
                    }}
                  />
                </Field>
                <span aria-hidden className="pb-2 text-muted-foreground">
                  =
                </span>
                <Field>
                  <FieldLabel htmlFor={`${id}-length`}>{t.form.length}</FieldLabel>
                  <MeterInput
                    id={`${id}-length`}
                    value={draft.lengthCm}
                    onValueChange={(lengthCm) => {
                      onChange({ lengthCm });
                    }}
                  />
                </Field>
              </div>
              {errors.conversion && <FieldError>{errors.conversion}</FieldError>}
              <RadioGroup
                value={draft.source}
                aria-label={t.form.source}
                className="flex flex-wrap gap-x-6 gap-y-2"
                onValueChange={(value) => {
                  onChange({ source: value === 'estimated' ? 'estimated' : 'measured' });
                }}
              >
                <Field orientation="horizontal" className="w-auto">
                  <RadioGroupItem value="measured" id={`${id}-measured`} />
                  <FieldLabel htmlFor={`${id}-measured`}>{t.form.measured}</FieldLabel>
                </Field>
                <Field orientation="horizontal" className="w-auto">
                  <RadioGroupItem value="estimated" id={`${id}-estimated`} />
                  <FieldLabel htmlFor={`${id}-estimated`}>{t.form.estimated}</FieldLabel>
                </Field>
              </RadioGroup>
            </>
          ) : (
            <Alert>
              <InfoIcon aria-hidden />
              <AlertDescription>{t.stock.unknownNote}</AlertDescription>
            </Alert>
          )}
        </>
      )}

      <StockPreview draft={draft} showTotal={showTotal} />

      {showPayment && (
        <>
          <Field data-invalid={errors.supplierId ? true : undefined}>
            <FieldLabel htmlFor={`${id}-supplier`}>{t.stock.supplier}</FieldLabel>
            <Select
              value={draft.supplierId ?? 'none'}
              onValueChange={(value) => {
                onChange({ supplierId: value === 'none' ? null : value });
              }}
            >
              <SelectTrigger id={`${id}-supplier`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t.stock.noSupplier}</SelectItem>
                {suppliers?.map((supplier) => (
                  <SelectItem key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.supplierId && <FieldError>{errors.supplierId}</FieldError>}
          </Field>
          <Field>
            <FieldLabel>{t.stock.payment}</FieldLabel>
            <RadioGroup
              value={draft.partPayment ? 'part' : 'full'}
              aria-label={t.stock.payment}
              className="flex flex-wrap gap-x-6 gap-y-2"
              onValueChange={(value) => {
                // Back to "all of it" drops the amount: what was typed is not kept in the dark.
                onChange(
                  value === 'part'
                    ? { partPayment: true }
                    : { partPayment: false, paidCents: null },
                );
              }}
            >
              <Field orientation="horizontal" className="w-auto">
                <RadioGroupItem value="full" id={`${id}-paid-full`} />
                <FieldLabel htmlFor={`${id}-paid-full`}>{t.stock.paidFull}</FieldLabel>
              </Field>
              <Field orientation="horizontal" className="w-auto">
                <RadioGroupItem value="part" id={`${id}-paid-part`} />
                <FieldLabel htmlFor={`${id}-paid-part`}>{t.stock.paidPart}</FieldLabel>
              </Field>
            </RadioGroup>
          </Field>
          {draft.partPayment && (
            <PartPayment
              draft={draft}
              onChange={onChange}
              error={errors.paidCents}
              inputId={`${id}-paid`}
            />
          )}
        </>
      )}
    </FieldGroup>
  );
}
