'use client';

import {
  type NewPurchase,
  newPurchaseSchema,
  previewPurchaseRolls,
  type PurchaseMethod,
  type Variant,
} from '@fabric/contracts';
import { costPerMeterCents, isRenewalCostHigher } from '@fabric/core';
import { PackageIcon, TriangleAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import {
  DeviceNotRegisteredError,
  type Local,
  useLiveQuery,
  useRepositories,
  ValidationError,
} from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice } from '@/shared/brand';
import { MeterInput, Meters, Money, MoneyInput, WeightInput } from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';
import { useAppNavigation } from '@/shared/lib/navigation';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Combobox } from '@/shared/ui/combobox';
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
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { Textarea } from '@/shared/ui/textarea';
import { PeriodLockHint, useLockedThrough } from '@/features/settlements';

const t = messages.purchasing;
const DEFAULT_ROLL_CM = 5000;

type Preview = ReturnType<typeof previewPurchaseRolls>;

/** The core's rolls for a valid draft, or null (a kg weight too small to give 1 cm…). */
function previewOf(input: NewPurchase): Preview | null {
  try {
    return previewPurchaseRolls(input);
  } catch {
    return null;
  }
}

/**
 * The confirmation summary (BUILD_PROMPTS 3.2): every roll with the code it will get, its length
 * and cost, the total, and the renewal-cost warning (SPEC §8.5).
 */
function ReviewDialog({
  input,
  preview,
  fabricId,
  colorName,
  onClose,
}: {
  input: NewPurchase;
  preview: Preview;
  fabricId: string;
  colorName: (variantId: string) => string;
  onClose: () => void;
}) {
  const repositories = useRepositories();
  const navigation = useAppNavigation();
  const [saving, setSaving] = useState(false);
  const codes = useLiveQuery(
    () => repositories.purchases.nextRollCodes(preview.rolls.length),
    [repositories, preview.rolls.length],
  );
  const previous = useLiveQuery(
    () => repositories.purchases.lastBatchOf(fabricId),
    [repositories, fabricId],
  );
  const renewalHigher =
    previous != null &&
    isRenewalCostHigher(
      previous,
      preview.rolls.map((roll) => ({
        costTotalCents: roll.costTotalCents,
        lengthCm: roll.lengthCmInitial,
      })),
    );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.summaryTitle}</DialogTitle>
          <DialogDescription>{t.summaryDescription}</DialogDescription>
        </DialogHeader>
        {renewalHigher && (
          <Alert>
            <TriangleAlertIcon aria-hidden />
            <AlertDescription>
              {t.renewalWarning}{' '}
              <span className="text-muted-foreground">
                ({t.renewalDetail}:{' '}
                <Money
                  cents={costPerMeterCents(
                    previous.reduce((sum, roll) => sum + roll.costTotalCents, 0),
                    previous.reduce((sum, roll) => sum + roll.lengthCm, 0),
                  )}
                />
                )
              </span>
            </AlertDescription>
          </Alert>
        )}
        <div className="max-h-[50svh] overflow-y-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.code}</TableHead>
                <TableHead>{t.fields.color}</TableHead>
                <TableHead className="text-end">{t.length}</TableHead>
                <TableHead className="text-end">{t.cost}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.rolls.map((roll, index) => (
                <TableRow key={`${roll.variantId}-${String(index)}`}>
                  <TableCell>
                    <bdi dir="ltr" data-num>
                      {codes?.[index] ?? '…'}
                    </bdi>
                  </TableCell>
                  <TableCell>{colorName(roll.variantId)}</TableCell>
                  <TableCell className="text-end">
                    <Meters cm={roll.lengthCmInitial} />
                    {roll.lengthEstimated && (
                      <Badge variant="warning" className="ms-1.5">
                        {t.estimated}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-end">
                    <Money cents={roll.costTotalCents} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3}>{t.total}</TableCell>
                <TableCell className="text-end font-semibold">
                  <Money cents={preview.totalCostCents} />
                </TableCell>
              </TableRow>
              {input.paidCents != null && input.paidCents < preview.totalCostCents && (
                <TableRow>
                  <TableCell colSpan={3}>{t.owed}</TableCell>
                  <TableCell className="text-end">
                    <Money cents={preview.totalCostCents - input.paidCents} tone="debt" />
                  </TableCell>
                </TableRow>
              )}
            </TableFooter>
          </Table>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {messages.forms.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={saving || codes === null}
            onClick={() => {
              setSaving(true);
              repositories.purchases
                .create(input)
                .then((id) => {
                  toast.success(t.saved, { description: messages.forms.saved });
                  navigation.push(`/purchases/view?id=${id}`);
                })
                .catch((error: unknown) => {
                  setSaving(false);
                  toast.error(
                    error instanceof DeviceNotRegisteredError
                      ? t.deviceNotRegistered
                      : (error instanceof ValidationError &&
                          t.issues[error.issues[0]?.message ?? '']) ||
                          messages.forms.invalid,
                  );
                });
            }}
          >
            {saving ? messages.forms.saving : t.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * New purchase (SPEC §2.3, §14.4): by the metre (a whole assortment in one go, one roll per
 * colour), a ready piece, or by weight (an estimated length). Works offline; costs come from
 * @fabric/core, the same as on the server.
 */
export function NewPurchaseScreen() {
  const id = useId();
  const repositories = useRepositories();
  const fabrics = useLiveQuery(() => repositories.fabrics.list(), [repositories]);
  const suppliers = useLiveQuery(() => repositories.suppliers.list(), [repositories]);
  const deviceReady = useLiveQuery(
    async () => (await repositories.purchases.nextRollCodes(1)) !== null,
    [repositories],
  );

  const [fabricId, setFabricId] = useState<string | null>(null);
  const variants = useLiveQuery(
    async () => (fabricId ? repositories.variants.listByFabric(fabricId) : []),
    [repositories, fabricId],
  );
  const [method, setMethod] = useState<PurchaseMethod>('meter');
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [date, setDate] = useState(() => shopToday());
  const lockedThrough = useLockedThrough();
  const [notes, setNotes] = useState('');
  // Paid now; empty: all of it. Less than the total leaves a debt to the supplier (SP1).
  const [paidNow, setPaidNow] = useState<number | null>(null);
  const [pricePerMeter, setPricePerMeter] = useState<number | null>(null);
  const [rollLength, setRollLength] = useState<number | null>(DEFAULT_ROLL_CM);
  const [lengths, setLengths] = useState<Record<string, number | null>>({});
  const [variantId, setVariantId] = useState<string | null>(null);
  const [pieceLength, setPieceLength] = useState<number | null>(null);
  const [totalCost, setTotalCost] = useState<number | null>(null);
  const [weight, setWeight] = useState<number | null>(null);
  const [estPerKg, setEstPerKg] = useState<number | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [reviewing, setReviewing] = useState<{ input: NewPurchase; preview: Preview } | null>(null);

  const colorName = useMemo(() => {
    const names = new Map((variants ?? []).map((variant) => [variant.id, variant.colorName]));
    return (variantIdToName: string) => names.get(variantIdToName) ?? '';
  }, [variants]);

  const draft = useMemo(() => {
    const common = { date, supplierId, notes, paidCents: paidNow };
    const input: Record<PurchaseMethod, unknown> = {
      meter: {
        method: 'meter',
        ...common,
        pricePerMeterCents: pricePerMeter,
        rolls: (variants ?? [])
          .filter((variant) => variant.id in lengths)
          .map((variant) => ({ variantId: variant.id, lengthCm: lengths[variant.id] })),
      },
      piece: {
        method: 'piece',
        ...common,
        variantId,
        lengthCm: pieceLength,
        totalCostCents: totalCost,
      },
      kg: {
        method: 'kg',
        ...common,
        variantId,
        weightG: weight,
        totalCostCents: totalCost,
        estCmPerKg: estPerKg,
      },
    };
    const parsed = newPurchaseSchema.safeParse(input[method]);
    if (!parsed.success) return null;
    const preview = previewOf(parsed.data);
    return preview ? { input: parsed.data, preview } : null;
  }, [
    method,
    date,
    supplierId,
    paidNow,
    notes,
    pricePerMeter,
    variants,
    lengths,
    variantId,
    pieceLength,
    totalCost,
    weight,
    estPerKg,
  ]);

  if (fabrics === undefined || deviceReady === undefined) return <LoadingState />;
  if (fabrics.length === 0) {
    return (
      <EmptyState
        icon={PackageIcon}
        title={t.noFabrics}
        action={
          <Button asChild>
            <Link href="/inventory/fabric">{t.addFabric}</Link>
          </Button>
        }
      />
    );
  }

  const chooseFabric = (next: string | null) => {
    const fabric = fabrics.find((candidate) => candidate.id === next);
    setFabricId(next);
    setSupplierId(fabric?.defaultSupplierId ?? null);
    setEstPerKg(fabric?.estCmPerKg ?? null);
    setLengths({});
    setVariantId(null);
  };
  const toggle = (variant: Local<Variant>, checked: boolean) => {
    setLengths((current) =>
      checked
        ? { ...current, [variant.id]: rollLength ?? DEFAULT_ROLL_CM }
        : Object.fromEntries(Object.entries(current).filter(([key]) => key !== variant.id)),
    );
  };
  const colorOptions = (variants ?? []).map((variant) => ({
    value: variant.id,
    label: variant.colorName,
  }));

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <OfflineNotice />
      <Button asChild variant="link" className="justify-self-start px-0">
        <Link href="/purchases">{t.back}</Link>
      </Button>
      <h2 className="font-heading text-xl font-semibold">{t.newPurchase}</h2>
      {!deviceReady && (
        <Alert>
          <TriangleAlertIcon aria-hidden />
          <AlertDescription>{t.deviceNotRegistered}</AlertDescription>
        </Alert>
      )}

      <form
        noValidate
        className="grid gap-6 rounded-xl border bg-card p-4 sm:p-6"
        onSubmit={(event) => {
          event.preventDefault();
          setAttempted(true);
          if (draft) setReviewing(draft);
        }}
      >
        <Tabs
          value={method}
          onValueChange={(value) => {
            setMethod(value as PurchaseMethod);
          }}
        >
          <TabsList>
            <TabsTrigger value="meter">{t.methods.meter}</TabsTrigger>
            <TabsTrigger value="piece">{t.methods.piece}</TabsTrigger>
            <TabsTrigger value="kg">{t.methods.kg}</TabsTrigger>
          </TabsList>
        </Tabs>

        <FieldGroup>
          <div className="grid gap-6 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`${id}-fabric`}>{t.fields.fabric}</FieldLabel>
              <Combobox
                id={`${id}-fabric`}
                options={fabrics.map((fabric) => ({ value: fabric.id, label: fabric.name }))}
                value={fabricId}
                onValueChange={chooseFabric}
                placeholder={t.fields.fabricPlaceholder}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-supplier`}>{t.fields.supplier}</FieldLabel>
              <Combobox
                id={`${id}-supplier`}
                options={(suppliers ?? []).map((supplier) => ({
                  value: supplier.id,
                  label: supplier.name,
                }))}
                value={supplierId}
                onValueChange={setSupplierId}
                placeholder={t.fields.supplierPlaceholder}
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor={`${id}-paid`}>
              {t.fields.paidNow}{' '}
              <span className="text-muted-foreground">({messages.forms.optional})</span>
            </FieldLabel>
            <MoneyInput
              id={`${id}-paid`}
              value={paidNow}
              onValueChange={setPaidNow}
              aria-describedby={`${id}-paid-hint`}
            />
            <p id={`${id}-paid-hint`} className="text-xs text-muted-foreground">
              {t.fields.paidNowHint}
            </p>
            {draft && paidNow !== null && paidNow < draft.preview.totalCostCents && (
              <p className="text-sm" aria-live="polite">
                {t.owed}: <Money cents={draft.preview.totalCostCents - paidNow} tone="debt" />
              </p>
            )}
            {paidNow !== null &&
              supplierId === null &&
              draft &&
              paidNow < draft.preview.totalCostCents && (
                <p role="alert" className="text-sm text-destructive">
                  {t.issues.purchase_debt_needs_supplier}
                </p>
              )}
          </Field>

          {fabricId && variants?.length === 0 && (
            <Alert>
              <AlertDescription>
                {t.noColors}{' '}
                <Link href={`/inventory/fabric?id=${fabricId}`} className="underline">
                  {t.editFabricColors}
                </Link>
              </AlertDescription>
            </Alert>
          )}

          {method === 'meter' && (
            <>
              <div className="grid gap-6 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor={`${id}-price`}>{t.fields.pricePerMeter}</FieldLabel>
                  <MoneyInput
                    id={`${id}-price`}
                    required
                    showError={attempted}
                    value={pricePerMeter}
                    onValueChange={setPricePerMeter}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-roll`}>{t.fields.rollLength}</FieldLabel>
                  <MeterInput
                    id={`${id}-roll`}
                    required
                    showError={attempted}
                    value={rollLength}
                    onValueChange={setRollLength}
                  />
                  <FieldDescription>{t.fields.rollLengthHint}</FieldDescription>
                </Field>
              </div>
              {(variants?.length ?? 0) > 0 && (
                <FieldSet>
                  <div className="flex items-center gap-2">
                    <FieldLegend variant="label" className="me-auto">
                      {t.fields.colors}
                    </FieldLegend>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setLengths(
                          Object.fromEntries(
                            (variants ?? []).map((variant) => [
                              variant.id,
                              lengths[variant.id] ?? rollLength ?? DEFAULT_ROLL_CM,
                            ]),
                          ),
                        );
                      }}
                    >
                      {t.fields.selectAll}
                    </Button>
                  </div>
                  <ul className="divide-y rounded-lg border">
                    {(variants ?? []).map((variant) => {
                      const selected = variant.id in lengths;
                      return (
                        <li key={variant.id} className="flex min-h-12 items-center gap-3 px-3 py-2">
                          <Checkbox
                            id={`${id}-color-${variant.id}`}
                            checked={selected}
                            onCheckedChange={(checked) => {
                              toggle(variant, checked === true);
                            }}
                          />
                          <label htmlFor={`${id}-color-${variant.id}`} className="me-auto">
                            {variant.colorName}
                          </label>
                          {selected && (
                            <MeterInput
                              aria-label={`${t.length}: ${variant.colorName}`}
                              className="w-36"
                              required
                              showError={attempted}
                              value={lengths[variant.id] ?? null}
                              onValueChange={(cm) => {
                                setLengths((current) => ({ ...current, [variant.id]: cm }));
                              }}
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </FieldSet>
              )}
            </>
          )}

          {method !== 'meter' && (
            <Field>
              <FieldLabel htmlFor={`${id}-color`}>{t.fields.color}</FieldLabel>
              <Combobox
                id={`${id}-color`}
                options={colorOptions}
                value={variantId}
                onValueChange={setVariantId}
                placeholder={t.fields.colorPlaceholder}
                disabled={!fabricId}
              />
            </Field>
          )}

          {method === 'piece' && (
            <div className="grid gap-6 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${id}-piece-length`}>{t.fields.pieceLength}</FieldLabel>
                <MeterInput
                  id={`${id}-piece-length`}
                  required
                  showError={attempted}
                  value={pieceLength}
                  onValueChange={setPieceLength}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-piece-price`}>{t.fields.piecePrice}</FieldLabel>
                <MoneyInput
                  id={`${id}-piece-price`}
                  required
                  showError={attempted}
                  value={totalCost}
                  onValueChange={setTotalCost}
                />
                {pieceLength !== null && pieceLength > 0 && totalCost !== null && (
                  <FieldDescription>
                    {t.costPerMeter}: <Money cents={costPerMeterCents(totalCost, pieceLength)} />
                  </FieldDescription>
                )}
              </Field>
            </div>
          )}

          {method === 'kg' && (
            <div className="grid gap-6 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor={`${id}-weight`}>{t.fields.weight}</FieldLabel>
                <WeightInput
                  id={`${id}-weight`}
                  required
                  showError={attempted}
                  value={weight}
                  onValueChange={setWeight}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-kg-price`}>{t.fields.weightPrice}</FieldLabel>
                <MoneyInput
                  id={`${id}-kg-price`}
                  required
                  showError={attempted}
                  value={totalCost}
                  onValueChange={setTotalCost}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-est`}>{t.fields.estPerKg}</FieldLabel>
                <MeterInput
                  id={`${id}-est`}
                  required
                  showError={attempted}
                  value={estPerKg}
                  onValueChange={setEstPerKg}
                />
              </Field>
            </div>
          )}

          <div className="grid gap-6 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`${id}-date`}>{t.fields.date}</FieldLabel>
              <Input
                id={`${id}-date`}
                type="date"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                }}
              />
              <PeriodLockHint date={date} lockedThrough={lockedThrough} />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-notes`}>{t.fields.notes}</FieldLabel>
              <Textarea
                id={`${id}-notes`}
                rows={1}
                maxLength={1000}
                value={notes}
                onChange={(event) => {
                  setNotes(event.target.value);
                }}
              />
            </Field>
          </div>
        </FieldGroup>

        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          {draft ? (
            <p className="me-auto" aria-live="polite">
              {t.total}: <Money cents={draft.preview.totalCostCents} className="font-semibold" />
              {method === 'kg' && draft.preview.rolls[0] && (
                <span className="ms-2 text-muted-foreground">
                  {t.estimatedLength}: <Meters cm={draft.preview.rolls[0].lengthCmInitial} />{' '}
                  <Badge variant="warning">{t.estimated}</Badge>
                </span>
              )}
            </p>
          ) : (
            <p className="me-auto text-sm text-muted-foreground">{t.reviewHint}</p>
          )}
          <Button type="submit" variant="accent" size="lg" disabled={!deviceReady}>
            {t.review}
          </Button>
        </div>
      </form>

      {reviewing && fabricId && (
        <ReviewDialog
          input={reviewing.input}
          preview={reviewing.preview}
          fabricId={fabricId}
          colorName={colorName}
          onClose={() => {
            setReviewing(null);
          }}
        />
      )}
    </div>
  );
}
