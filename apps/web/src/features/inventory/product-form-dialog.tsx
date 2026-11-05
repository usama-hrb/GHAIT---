'use client';

import {
  enabledSellingUnits,
  PRODUCT_SELLING_UNITS,
  PRODUCT_UNITS,
  type PhotoImage,
  type Product,
  type ProductInput,
  type ProductSellingUnit,
  type ProductUnit,
} from '@fabric/contracts';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { PhotoField } from '@/features/catalog';
import { useSellingUnits } from '@/features/settings';
import { messages } from '@/i18n';
import { type Local, useLiveQuery, useRepositories, ValidationError } from '@/local-db';
import { CountInput, MeterInput, MoneyInput, WeightInput } from '@/shared/format';
import { errorsByField } from '@/shared/lib/form-errors';
import { compressImage, ImageError } from '@/shared/lib/image';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldLabel,
  FieldSet,
} from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import { Switch } from '@/shared/ui/switch';
import { Textarea } from '@/shared/ui/textarea';
import {
  COST_FIELD,
  emptyStockDraft,
  isCostMissing,
  StockFields,
  type StockDraft,
  stockPurchaseOf,
} from './stock-fields';

const t = messages.productStock;

/** "summer، soft" → ['summer', 'soft']. */
function splitTags(text: string): string[] {
  return text
    .split(/[،,]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

const toggled = <T extends string>(list: readonly T[], value: T, on: boolean): T[] =>
  on
    ? [...list.filter((entry) => entry !== value), value]
    : list.filter((entry) => entry !== value);

/**
 * Add or edit a product (ADR 0012): its name, code, picture and description; what it sells by and
 * for how much (the normal price and the minimum a cashier may sell at); and, when adding, the
 * first stock — bought by weight, length or piece — saved with the product or not at all.
 * Validation is the contract's, the same rules the server applies. The purchase cost lives with
 * the stock, not the product, and is never shown to cashiers.
 */
export function ProductFormDialog({
  product,
  onClose,
  onSaved,
}: {
  /** Editing this product; without it, a new one. */
  product?: Local<Product>;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const id = useId();
  const repositories = useRepositories();
  const [name, setName] = useState(product?.name ?? '');
  const [sku, setSku] = useState(product?.sku ?? '');
  const [notes, setNotes] = useState(product?.description ?? '');
  const [tags, setTags] = useState(product?.tags.join(messages.forms.listSeparator) ?? '');
  const [purchaseUnits, setPurchaseUnits] = useState<ProductUnit[]>(product?.purchaseUnits ?? []);
  // What the shop sells in decides the units offered (ADR 0023). A new product starts with the
  // first unit on; until the owner changes it, it follows the setting as the device reads it.
  const shopUnits = useSellingUnits();
  const sellable = enabledSellingUnits(shopUnits);
  const [pickedSelling, setPickedSelling] = useState<ProductSellingUnit[] | null>(null);
  const sellingUnits: ProductSellingUnit[] =
    pickedSelling ?? product?.sellingUnits ?? sellable.slice(0, 1);
  // A unit the product already has stays listed even if the shop switched it off, so it can be
  // taken off; one it does not have is offered only while the shop uses it.
  const soldChoices = PRODUCT_SELLING_UNITS.filter(
    (unit) => sellable.includes(unit) || product?.sellingUnits.includes(unit),
  );
  const boughtChoices = PRODUCT_UNITS.filter(
    (unit) => shopUnits[unit] || product?.purchaseUnits.includes(unit),
  );
  const [prices, setPrices] = useState({
    pricePerMeterCents: product?.pricePerMeterCents ?? null,
    minPricePerMeterCents: product?.minPricePerMeterCents ?? null,
    pricePerPieceCents: product?.pricePerPieceCents ?? null,
    minPricePerPieceCents: product?.minPricePerPieceCents ?? null,
  });
  const [lowStock, setLowStock] = useState<number | null>(product?.lowStockThreshold ?? null);
  const [weightG, setWeightG] = useState<number | null>(
    product?.kgToMeterConversion?.weightG ?? null,
  );
  const [lengthCm, setLengthCm] = useState<number | null>(
    product?.kgToMeterConversion?.lengthCm ?? null,
  );
  const [source, setSource] = useState<'estimated' | 'measured'>(
    product?.kgToMeterConversion?.source ?? 'measured',
  );
  const [withStock, setWithStock] = useState(true);
  const [stock, setStock] = useState<StockDraft>(emptyStockDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // The picture: the product's own, or a change made here and saved with the product.
  const photos = useLiveQuery(() => repositories.photos.sources(), [repositories]);
  const [picked, setPicked] = useState<PhotoImage | 'removed' | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const shownPhoto =
    picked === 'removed'
      ? undefined
      : picked
        ? `data:${picked.contentType};base64,${picked.data}`
        : product && photos?.get(product.id);

  const editing = product !== undefined;
  const changed = () => {
    setErrors({});
  };
  const patchStock = (patch: Partial<StockDraft>) => {
    setStock((current) => ({ ...current, ...patch }));
    changed();
  };
  const patchPrices = (patch: Partial<typeof prices>) => {
    setPrices((current) => ({ ...current, ...patch }));
    changed();
  };

  const pickFile = (file: File) => {
    setPhotoError(null);
    setPreparing(true);
    compressImage(file)
      .then(setPicked)
      .catch((error: unknown) => {
        setPhotoError(
          error instanceof ImageError && error.reason === 'too_large'
            ? messages.catalog.photo.tooLarge
            : messages.catalog.photo.unreadable,
        );
      })
      .finally(() => {
        setPreparing(false);
      });
  };

  const submit = async () => {
    // Both halves of the relation, or neither: one alone says nothing.
    if ((weightG === null) !== (lengthCm === null)) {
      setErrors({ kgToMeterConversion: t.form.issues.conversionIncomplete });
      return;
    }
    const purchase = !editing && withStock ? stockPurchaseOf(stock) : null;
    if (!editing && withStock && purchase === null) {
      setErrors({
        quantity: stock.quantity === null ? t.form.issues.product_price_required : '',
        [COST_FIELD]: isCostMissing(stock) ? t.form.issues.product_price_required : '',
      });
      return;
    }
    const conversion =
      weightG !== null && lengthCm !== null
        ? { weightG, lengthCm, source }
        : (purchase?.conversion ?? null);
    const meter = sellingUnits.includes('meter');
    const piece = sellingUnits.includes('piece');
    const input: ProductInput = {
      name,
      sku,
      description: notes,
      tags: splitTags(tags),
      purchaseUnits,
      sellingUnits,
      kgToMeterConversion: conversion,
      pricePerMeterCents: meter ? prices.pricePerMeterCents : null,
      minPricePerMeterCents: meter ? prices.minPricePerMeterCents : null,
      pricePerPieceCents: piece ? prices.pricePerPieceCents : null,
      minPricePerPieceCents: piece ? prices.minPricePerPieceCents : null,
      lowStockThreshold: lowStock,
      active: product?.active ?? true,
    };
    setSaving(true);
    try {
      let savedId: string;
      if (editing) {
        savedId = await repositories.products.save(input, product.id);
      } else {
        savedId = (await repositories.productInventory.addProduct(input, purchase)).productId;
      }
      if (picked === 'removed') await repositories.photos.remove(savedId);
      else if (picked) await repositories.photos.set(savedId, picked);
      toast.success(messages.forms.saved);
      onSaved?.(savedId);
      onClose();
    } catch (error) {
      setSaving(false);
      if (!(error instanceof ValidationError)) throw error;
      setErrors(errorsByField(error.issues, t.form.issues));
    }
  };

  const sellsMeter = sellingUnits.includes('meter');
  const sellsPiece = sellingUnits.includes('piece');
  const priceFields = (unit: ProductSellingUnit) => {
    const price = unit === 'meter' ? 'pricePerMeterCents' : 'pricePerPieceCents';
    const min = unit === 'meter' ? 'minPricePerMeterCents' : 'minPricePerPieceCents';
    return (
      <div className="grid gap-4 sm:grid-cols-2" key={unit}>
        <Field data-invalid={errors[price] ? true : undefined}>
          <FieldLabel htmlFor={`${id}-${price}`}>
            {t.form.normalPrice} · {t.perUnit[unit]}
          </FieldLabel>
          <MoneyInput
            id={`${id}-${price}`}
            value={prices[price]}
            onValueChange={(cents) => {
              patchPrices({ [price]: cents });
            }}
          />
          {errors[price] && <FieldError>{errors[price]}</FieldError>}
        </Field>
        <Field data-invalid={errors[min] ? true : undefined}>
          <FieldLabel htmlFor={`${id}-${min}`}>
            {t.form.minPrice} · {t.perUnit[unit]}
          </FieldLabel>
          <MoneyInput
            id={`${id}-${min}`}
            value={prices[min]}
            onValueChange={(cents) => {
              patchPrices({ [min]: cents });
            }}
          />
          {errors[min] && <FieldError>{errors[min]}</FieldError>}
        </Field>
      </div>
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <form
          noValidate
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{editing ? t.form.editTitle : t.form.createTitle}</DialogTitle>
            <DialogDescription>{t.form.description}</DialogDescription>
          </DialogHeader>

          <FieldSet>
            <FieldLegend>{t.form.sections.details}</FieldLegend>
            <FieldGroup>
              <Field data-invalid={errors.name ? true : undefined}>
                <FieldLabel htmlFor={`${id}-name`}>{t.form.name}</FieldLabel>
                <Input
                  id={`${id}-name`}
                  value={name}
                  placeholder={t.form.namePlaceholder}
                  aria-invalid={errors.name ? true : undefined}
                  onChange={(event) => {
                    setName(event.target.value);
                    changed();
                  }}
                />
                {errors.name && <FieldError>{errors.name}</FieldError>}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={errors.sku ? true : undefined}>
                  <FieldLabel htmlFor={`${id}-sku`}>{t.form.code}</FieldLabel>
                  <Input
                    id={`${id}-sku`}
                    value={sku}
                    dir="ltr"
                    aria-invalid={errors.sku ? true : undefined}
                    onChange={(event) => {
                      setSku(event.target.value);
                      changed();
                    }}
                  />
                  {errors.sku && <FieldError>{errors.sku}</FieldError>}
                </Field>
                <Field data-invalid={errors.tags ? true : undefined}>
                  <FieldLabel htmlFor={`${id}-tags`}>{t.form.tags}</FieldLabel>
                  <Input
                    id={`${id}-tags`}
                    value={tags}
                    aria-invalid={errors.tags ? true : undefined}
                    onChange={(event) => {
                      setTags(event.target.value);
                      changed();
                    }}
                  />
                  <FieldDescription>{t.form.tagsHint}</FieldDescription>
                  {errors.tags && <FieldError>{errors.tags}</FieldError>}
                </Field>
              </div>
              <Field data-invalid={errors.description ? true : undefined}>
                <FieldLabel htmlFor={`${id}-notes`}>{t.form.notes}</FieldLabel>
                <Textarea
                  id={`${id}-notes`}
                  value={notes}
                  rows={2}
                  aria-invalid={errors.description ? true : undefined}
                  onChange={(event) => {
                    setNotes(event.target.value);
                    changed();
                  }}
                />
                {errors.description && <FieldError>{errors.description}</FieldError>}
              </Field>
              <Field>
                <FieldLabel>{t.form.image}</FieldLabel>
                <PhotoField
                  src={shownPhoto}
                  busy={preparing}
                  error={photoError}
                  onFile={pickFile}
                  onRemove={() => {
                    setPicked('removed');
                  }}
                />
              </Field>
            </FieldGroup>
          </FieldSet>

          <FieldSet>
            <FieldLegend>{t.form.sections.selling}</FieldLegend>
            <FieldGroup>
              <FieldSet data-invalid={errors.sellingUnits ? true : undefined}>
                <FieldLegend variant="label">{t.form.soldIn}</FieldLegend>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  {soldChoices.map((unit) => (
                    <Field key={unit} orientation="horizontal" className="w-auto">
                      <Checkbox
                        id={`${id}-sell-${unit}`}
                        checked={sellingUnits.includes(unit)}
                        onCheckedChange={(checked) => {
                          setPickedSelling(toggled(sellingUnits, unit, checked === true));
                          changed();
                        }}
                      />
                      <FieldLabel htmlFor={`${id}-sell-${unit}`}>{t.units[unit]}</FieldLabel>
                    </Field>
                  ))}
                </div>
                {soldChoices.length === 0 && (
                  <FieldDescription role="status">{t.form.noSoldUnits}</FieldDescription>
                )}
                {errors.sellingUnits && <FieldError>{errors.sellingUnits}</FieldError>}
              </FieldSet>
              {sellsMeter && priceFields('meter')}
              {sellsPiece && priceFields('piece')}
              <FieldDescription>{t.form.priceHint}</FieldDescription>
              <Field data-invalid={errors.lowStockThreshold ? true : undefined}>
                <FieldLabel htmlFor={`${id}-low`}>{t.form.lowStock}</FieldLabel>
                {sellsMeter ? (
                  <MeterInput id={`${id}-low`} value={lowStock} onValueChange={setLowStock} />
                ) : (
                  <CountInput id={`${id}-low`} value={lowStock} onValueChange={setLowStock} />
                )}
                <FieldDescription>{t.form.lowStockHint}</FieldDescription>
                {errors.lowStockThreshold && <FieldError>{errors.lowStockThreshold}</FieldError>}
              </Field>
            </FieldGroup>
          </FieldSet>

          {editing && (
            <FieldSet data-invalid={errors.purchaseUnits ? true : undefined}>
              <FieldLegend variant="label">{t.form.boughtIn}</FieldLegend>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {boughtChoices.map((unit) => (
                  <Field key={unit} orientation="horizontal" className="w-auto">
                    <Checkbox
                      id={`${id}-buy-${unit}`}
                      checked={purchaseUnits.includes(unit)}
                      onCheckedChange={(checked) => {
                        setPurchaseUnits(toggled(purchaseUnits, unit, checked === true));
                        changed();
                      }}
                    />
                    <FieldLabel htmlFor={`${id}-buy-${unit}`}>{t.units[unit]}</FieldLabel>
                  </Field>
                ))}
              </div>
              {errors.purchaseUnits && <FieldError>{errors.purchaseUnits}</FieldError>}
            </FieldSet>
          )}

          {editing && (
            <FieldSet data-invalid={errors.kgToMeterConversion ? true : undefined}>
              <FieldLegend variant="label">{t.form.conversion}</FieldLegend>
              <FieldDescription>{t.form.conversionHint}</FieldDescription>
              <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                <Field>
                  <FieldLabel htmlFor={`${id}-weight`}>{t.form.weight}</FieldLabel>
                  <WeightInput
                    id={`${id}-weight`}
                    value={weightG}
                    onValueChange={(grams) => {
                      setWeightG(grams);
                      changed();
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
                    value={lengthCm}
                    onValueChange={(cm) => {
                      setLengthCm(cm);
                      changed();
                    }}
                  />
                </Field>
              </div>
              {errors.kgToMeterConversion && <FieldError>{errors.kgToMeterConversion}</FieldError>}
              {weightG !== null && lengthCm !== null && (
                <RadioGroup
                  value={source}
                  aria-label={t.form.source}
                  className="flex flex-wrap gap-x-6 gap-y-2"
                  onValueChange={(value) => {
                    setSource(value === 'estimated' ? 'estimated' : 'measured');
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
              )}
            </FieldSet>
          )}

          {!editing && (
            <FieldSet>
              <FieldLegend>{t.form.sections.stock}</FieldLegend>
              <Field orientation="horizontal">
                <Switch
                  id={`${id}-with-stock`}
                  checked={withStock}
                  onCheckedChange={setWithStock}
                />
                <FieldLabel htmlFor={`${id}-with-stock`}>{t.stock.toggle}</FieldLabel>
              </Field>
              <FieldDescription>{t.stock.toggleHint}</FieldDescription>
              {withStock && <StockFields draft={stock} onChange={patchStock} errors={errors} />}
            </FieldSet>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {messages.forms.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={saving || preparing}>
              {saving
                ? messages.forms.saving
                : !editing && withStock
                  ? t.form.saveWithStock
                  : t.form.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
