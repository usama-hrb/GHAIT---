'use client';

import {
  formatLengthMeters,
  formatMoneyAmount,
  isBelowMinimum,
  parseLengthInput,
  parseMoneyInput,
  parseScaledDecimal,
  unitPriceForLineTotal,
} from '@fabric/core';
import { TriangleAlertIcon } from 'lucide-react';
import { type KeyboardEvent, type PointerEvent, useId, useMemo, useState } from 'react';
import { useSellingUnits } from '@/features/settings';
import { messages } from '@/i18n';
import {
  type BatchChoice,
  type ProductStockView,
  useLiveQuery,
  useRepositories,
  useSession,
} from '@/local-db';
import {
  COUNT_PAD,
  CountInput,
  Keypad,
  LENGTH_PAD,
  MeterInput,
  Meters,
  Money,
  MoneyInput,
  moneyPad,
  Quantity,
  useMoneyUnit,
  usePadFields,
} from '@/shared/format';
import { ProductPhoto } from '@/shared/brand';
import { useMediaQuery } from '@/shared/hooks/use-media-query';
import { shopToday } from '@/shared/lib/dates';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Switch } from '@/shared/ui/switch';
import {
  AUTO,
  type CartItem,
  type CartUnit,
  heldByBill,
  itemPrice,
  itemQuantity,
  pricedItemOf,
  priceKeyOf,
  type SaleLineInput,
  withoutCode,
} from './cart';
import { Authorization, ConfirmSwitch } from './authorization';

const t = messages.pos;

/** A quick button must not take the focus from the field being typed in. */
const keepFocus = (event: PointerEvent<HTMLElement>) => {
  event.preventDefault();
};

/** Lengths a customer often asks for, in metres, and counts of pieces: one tap fills the field. */
const QUICK_LENGTHS = [2.5, 3] as const;
const QUICK_PIECES = [1, 2, 5] as const;

/**
 * A phone: a narrow screen, or one held sideways (too short for two columns). It types with its own
 * keyboard; a tablet or a desktop gets the keypad beside the fields.
 */
const PHONE = '(max-width: 639.98px), (max-height: 499.98px)';

const quantityOf = (unit: CartUnit, text: string): number | null => {
  const parsed = unit === 'meter' ? parseLengthInput(text) : parseScaledDecimal(text, 0);
  return parsed.ok && parsed.value > 0 ? parsed.value : null;
};

/**
 * Adds a product to the bill, or changes a line already on it: the quantity and the price are
 * typed on the keypad beside the fields (tap a field to type in it) on a tablet or a desktop, and
 * with the phone's own numeric keyboard on a phone, where there is no keypad at all. The app
 * proposes the batch(es) and shows the line's total as it stands. Under the product's minimum price a cashier cannot go on; the owner
 * can, after one explicit confirmation that is recorded on the line (ADR 0012). Under the line's
 * cost the owner confirms too, apart. Both are asked here, where the price is typed, and each is
 * tied to the price it was given for: change the price and it asks again. The payment does not ask
 * for them a second time (`needsCostConfirmationAtPayment`).
 */
export function LineDialog({
  product,
  photo,
  others,
  editing,
  onSubmit,
  onClose,
}: {
  product: ProductStockView;
  /** The product's picture (a data: URL), if it has one. */
  photo: string | undefined;
  /** The rest of the bill: it holds some of the batches and is costed first. */
  others: readonly CartItem[];
  /** The line being changed (its own quantity is free for the proposal). */
  editing: CartItem | null;
  onSubmit: (item: CartItem) => void;
  onClose: () => void;
}) {
  const id = useId();
  const repositories = useRepositories();
  const { unit: moneyUnit } = useMoneyUnit();
  const { user } = useSession();
  const owner = user?.role === 'owner' ? user.username : null;
  const phone = useMediaQuery(PHONE);
  const keypad = !phone;

  // A unit the shop has switched off is not offered for a new line (ADR 0023); a line already on
  // the bill keeps its own unit, so it can still be changed.
  const units = useSellingUnits();
  const sellsMeter =
    (units.meter || editing?.unit === 'meter') &&
    product.sellingUnits.includes('meter') &&
    product.availableCm > 0;
  const sellsPiece =
    (units.piece || editing?.unit === 'piece') &&
    product.sellingUnits.includes('piece') &&
    product.availablePieces > 0;
  const [saleUnit, setSaleUnit] = useState<CartUnit>(
    editing?.unit ?? (sellsMeter ? 'meter' : 'piece'),
  );
  const normalOf = (unit: CartUnit) =>
    (unit === 'meter' ? product.pricePerMeterCents : product.pricePerPieceCents) ?? 0;
  const minOf = (unit: CartUnit) =>
    (unit === 'meter' ? product.minPricePerMeterCents : product.minPricePerPieceCents) ?? 0;
  const normalCents = normalOf(saleUnit);
  const minCents = minOf(saleUnit);

  const editedPrice = editing ? itemPrice(editing) : undefined;
  const format = (cents: number) => formatMoneyAmount(cents, moneyUnit, { grouping: false });
  const rules = {
    qty: saleUnit === 'meter' ? LENGTH_PAD : COUNT_PAD,
    price: moneyPad(moneyUnit),
    whole: moneyPad(moneyUnit),
    total: moneyPad(moneyUnit),
  };
  const pad = usePadFields<'qty' | 'price' | 'whole' | 'total'>(
    {
      qty: editing
        ? editing.unit === 'meter'
          ? formatLengthMeters(itemQuantity(editing), { grouping: false })
          : String(itemQuantity(editing))
        : '',
      price: format(
        editedPrice && 'perUnitCents' in editedPrice
          ? editedPrice.perUnitCents
          : normalOf(editing?.unit ?? saleUnit),
      ),
      whole: format(
        editedPrice && 'wholePieceCents' in editedPrice
          ? editedPrice.wholePieceCents
          : (product.pricePerPieceCents ?? 0),
      ),
      total: '',
    },
    rules,
    editedPrice && 'wholePieceCents' in editedPrice ? 'whole' : 'qty',
  );
  const [batchChoice, setBatchChoice] = useState(editing?.batchChoice ?? AUTO);
  const [wholePiece, setWholePiece] = useState(
    editedPrice !== undefined && 'wholePieceCents' in editedPrice,
  );
  const [minConfirmed, setMinConfirmed] = useState(
    editing?.lines.some((line) => line.minOverrideBy !== null) ?? false,
  );
  const [costConfirmed, setCostConfirmed] = useState(editing?.belowCostConfirmed ?? false);
  // The price may be given as what the customer pays for the whole quantity (3 m for 145.20), when
  // the price of one unit is not known: the price per unit is then worked out from it (core).
  const [byTotal, setByTotal] = useState(false);

  const quantity = quantityOf(saleUnit, pad.texts.qty);
  const priceParsed = parseMoneyInput(pad.texts.price, moneyUnit);
  const unitPrice = priceParsed.ok ? priceParsed.value : null;
  const wholeParsed = parseMoneyInput(pad.texts.whole, moneyUnit);
  const wholePrice = wholeParsed.ok ? wholeParsed.value : null;
  const totalParsed = parseMoneyInput(pad.texts.total, moneyUnit);
  const totalCents = totalParsed.ok ? totalParsed.value : null;

  /** What the rest of the bill already holds of each batch, so this line is proposed what is left. */
  const taken = useMemo(() => heldByBill(others, saleUnit), [others, saleUnit]);

  const allBatches = useLiveQuery(
    () => repositories.sales.batchesOfProduct(product.id),
    [repositories, product.id],
  );
  const leftOf = (choice: BatchChoice) =>
    saleUnit === 'meter' ? choice.remainingCm : choice.remainingPieces;
  const batches = allBatches?.filter((choice) => leftOf(choice) > 0);
  const chosen = batches?.find((choice) => choice.batch.id === batchChoice);
  const canSellWhole =
    saleUnit === 'meter' &&
    units.piece &&
    product.sellingUnits.includes('piece') &&
    product.pricePerPieceCents != null &&
    chosen !== undefined &&
    chosen.untouched &&
    !taken.has(chosen.batch.id);
  const piece = wholePiece && canSellWhole;
  const selling = piece ? chosen.remainingCm : quantity;
  // A whole piece is already priced as a total, so the switch is for the other lines only.
  const totalMode = byTotal && !piece;
  const priceFromTotal =
    totalMode && totalCents !== null && quantity !== null
      ? unitPriceForLineTotal({ unit: saleUnit, quantity, totalCents })
      : null;

  const proposal = useLiveQuery(async () => {
    if (selling === null || selling <= 0) return null;
    if (chosen) {
      const left = leftOf(chosen) - (taken.get(chosen.batch.id) ?? 0);
      return left >= selling
        ? { takes: [{ choice: chosen, quantity: selling }], shortfall: 0 }
        : { takes: [], shortfall: selling, tooShort: true as const };
    }
    const found = await repositories.sales.propose(product.id, saleUnit, selling, taken);
    return {
      takes: found.takes.map(({ take, choice }) => ({
        choice,
        quantity:
          take.quantity.unit === 'meter'
            ? take.quantity.centimeters
            : take.quantity.unit === 'piece'
              ? take.quantity.pieces
              : 0,
      })),
      shortfall: found.shortfall,
    };
  }, [repositories, product.id, saleUnit, selling, chosen, taken]);

  const priceCents = piece ? wholePrice : totalMode ? priceFromTotal : unitPrice;
  const price: SaleLineInput['price'] | null =
    priceCents === null
      ? null
      : piece
        ? { wholePieceCents: priceCents }
        : { perUnitCents: priceCents };
  // A confirmation is for the price it was given at: another price (typed, a quick button, the
  // whole piece, another unit) drops both, and asks again.
  const priceKey = price === null ? null : priceKeyOf(saleUnit, price);
  const [confirmedAt, setConfirmedAt] = useState(priceKey);
  if (priceKey !== confirmedAt) {
    setConfirmedAt(priceKey);
    setMinConfirmed(false);
    setCostConfirmed(false);
  }
  const shortfall = proposal?.shortfall ?? 0;
  const proposed = proposal && shortfall === 0 && proposal.takes.length > 0 ? proposal : null;

  // Under the product's minimum price: the cashier stops here, the owner confirms (ADR 0012).
  const below =
    proposed !== null &&
    price !== null &&
    isBelowMinimum({
      quantity: proposed.takes.reduce((sum, take) => sum + take.quantity, 0),
      price,
      minPriceCents: minCents,
    });
  const overrideBy = below && owner !== null && minConfirmed ? owner : null;

  const item = useMemo((): CartItem | null => {
    if (!proposed || price === null) return null;
    return {
      key: editing?.key ?? crypto.randomUUID(),
      product: { id: product.id, name: product.name },
      unit: saleUnit,
      batchChoice,
      belowCostConfirmed: owner !== null && costConfirmed,
      lines: proposed.takes.map((take) => ({
        batchId: take.choice.batch.id,
        batchCode: take.choice.batch.code,
        unit: saleUnit,
        quantity: take.quantity,
        price,
        refPriceCents: normalCents,
        minPriceCents: minCents,
        minOverrideBy: overrideBy,
      })),
    };
    // `price` is a fresh object each render: the cents it holds are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps, @eslint-react/exhaustive-deps -- see above
  }, [
    product.id,
    product.name,
    saleUnit,
    batchChoice,
    proposed,
    priceCents,
    piece,
    normalCents,
    minCents,
    overrideBy,
    owner,
    costConfirmed,
    editing,
  ]);

  // The line priced after the rest of the bill, so its cost and warnings are the real ones.
  const priced = useLiveQuery(async () => {
    if (!item) return null;
    try {
      const sale = await repositories.sales.preview({
        date: shopToday(),
        customerId: null,
        lines: [...others, item].flatMap((entry) => entry.lines.map(withoutCode)),
        discountCents: 0,
        paidCents: 0,
        dueDate: null,
        confirmedBelowCost: true,
        note: null,
      });
      return pricedItemOf(
        item,
        sale,
        others.reduce((sum, entry) => sum + entry.lines.length, 0),
      );
    } catch {
      return null;
    }
  }, [repositories, item, others]);

  // The line is priced after each change; what it said for the last one is not an answer for this
  // one. Until it answers, it cannot be added: a cost confirmation asked late would be asked twice.
  const pricing =
    item !== null && (priced === undefined || (priced !== null && priced.item !== item));
  // Under the line's cost (the owner's costs only: a cashier's device has none).
  const belowCost = priced?.belowCost === true;
  const blocked =
    pricing || (below && overrideBy === null) || (belowCost && !(owner !== null && costConfirmed));

  const handleSubmit = () => {
    if (!item || blocked) return;
    onSubmit(item);
  };

  const field = (name: 'qty' | 'price' | 'whole' | 'total') => ({
    keypad,
    large: true,
    className: phone ? 'h-12 pointer-coarse:h-12' : 'h-14 pointer-coarse:h-14',
    text: pad.texts[name],
    onTextChange: (text: string) => {
      pad.type(name, text);
    },
    onFocus: () => {
      pad.activate(name);
    },
  });
  /** A quick button fills a field and moves the typing there (the keyboard too). */
  const fill = (name: 'qty' | 'price' | 'whole', text: string) => {
    pad.fill(name, text);
    document.getElementById(`${id}-${name}`)?.focus();
  };
  const changeUnit = (next: CartUnit) => {
    setSaleUnit(next);
    setBatchChoice(AUTO);
    setWholePiece(false);
    pad.fill('qty', '');
    // The typing ends in the field that is shown: the total in a line priced by its total.
    if (byTotal) {
      pad.fill('price', format(normalOf(next)));
      pad.fill('total', '');
    } else {
      pad.fill('total', '');
      pad.fill('price', format(normalOf(next)));
    }
  };
  const changeByTotal = (on: boolean) => {
    setByTotal(on);
    if (on) {
      pad.fill('total', '');
      // The field is not there until this render is done.
      requestAnimationFrame(() => {
        document.getElementById(`${id}-total`)?.focus();
      });
    } else if (priceFromTotal !== null) {
      // What was worked out stays as the price, to be changed or kept.
      pad.fill('price', format(priceFromTotal));
    }
  };
  // The unit price is rounded to the cent, so the line can come a few cents off the typed total.
  const roundedTo =
    totalMode && totalCents !== null && !pricing && priced && priced.totalCents !== totalCents
      ? priced.totalCents
      : null;

  const onEnter = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.repeat) return;
    // Enter on a button, switch or list presses that control; it submits from the fields.
    if (
      event.target instanceof HTMLElement &&
      event.target.closest('button, [role="switch"], [role="combobox"]')
    ) {
      return;
    }
    event.preventDefault();
    handleSubmit();
  };

  const needsMinimum = below;
  const needsCost = belowCost && owner !== null;

  // Quick lengths and counts only when the stock can cover them.
  const presets = (saleUnit === 'meter' ? QUICK_LENGTHS : QUICK_PIECES).filter((amount) => {
    const asked = quantityOf(saleUnit, String(amount));
    return (
      asked !== null &&
      asked <= (saleUnit === 'meter' ? product.availableCm : product.availablePieces)
    );
  });
  const unitLabel = saleUnit === 'meter' ? messages.units.meter : messages.units.piece;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* As tall as its content: the body scrolls only when the screen is shorter, the footer stays. */}
      <DialogContent
        className={cn(
          'flex flex-col gap-3 overflow-hidden',
          keypad ? 'sm:max-w-2xl' : 'sm:max-w-md',
        )}
        onKeyDown={onEnter}
      >
        <DialogHeader className="shrink-0 flex-row items-center gap-3 pe-10">
          <ProductPhoto src={photo} className="size-11 shrink-0 rounded-lg" />
          <div className="grid min-w-0 gap-0.5">
            <DialogTitle className="truncate">{product.name}</DialogTitle>
            <DialogDescription className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span>
                {t.available}:{' '}
                <span className="font-medium text-foreground">
                  {product.availableCm > 0 && <Meters cm={product.availableCm} />}
                  {product.availableCm > 0 && product.availablePieces > 0 && ' · '}
                  {product.availablePieces > 0 && (
                    <Quantity unit="piece" amount={product.availablePieces} />
                  )}
                </span>
              </span>
              <span>
                {t.reference}:{' '}
                <span className="font-medium text-foreground">
                  <Money cents={normalCents} /> / {unitLabel}
                </span>
              </span>
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4">
          {/* The fields; the keypad beside them on a tablet or a desktop, none on a phone. */}
          <div className={cn('grid gap-4', keypad && 'grid-cols-[minmax(0,1fr)_15rem]')}>
            <FieldGroup className="gap-3">
              {sellsMeter && sellsPiece && (
                <Field>
                  <FieldLabel>{t.fields.soldBy}</FieldLabel>
                  <div role="group" aria-label={t.fields.soldBy} className="grid grid-cols-2 gap-2">
                    {(['meter', 'piece'] as const).map((choice) => (
                      <Button
                        key={choice}
                        type="button"
                        variant={saleUnit === choice ? 'default' : 'outline'}
                        aria-pressed={saleUnit === choice}
                        className="touch-manipulation pointer-coarse:h-11"
                        onClick={() => {
                          changeUnit(choice);
                        }}
                      >
                        {messages.productStock.units[choice]}
                      </Button>
                    ))}
                  </div>
                </Field>
              )}
              {piece ? (
                <Field>
                  <FieldLabel htmlFor={`${id}-whole`}>{t.fields.piecePrice}</FieldLabel>
                  <MoneyInput id={`${id}-whole`} value={wholePrice} {...field('whole')} />
                </Field>
              ) : (
                <>
                  <Field className="gap-1.5">
                    <FieldLabel htmlFor={`${id}-qty`}>
                      {saleUnit === 'meter' ? t.fields.length : t.fields.quantity}
                    </FieldLabel>
                    {saleUnit === 'meter' ? (
                      <MeterInput id={`${id}-qty`} value={quantity} {...field('qty')} />
                    ) : (
                      <CountInput id={`${id}-qty`} value={quantity} {...field('qty')} />
                    )}
                    {presets.length > 0 && (
                      <div
                        role="group"
                        aria-label={t.line.quickLength}
                        className="flex flex-wrap gap-2"
                        onPointerDown={keepFocus}
                      >
                        {presets.map((amount) => (
                          <Button
                            key={amount}
                            type="button"
                            variant="outline"
                            size="sm"
                            className="touch-manipulation pointer-coarse:px-4"
                            onClick={() => {
                              fill('qty', String(amount));
                            }}
                          >
                            {amount} {unitLabel}
                          </Button>
                        ))}
                      </div>
                    )}
                    {proposal && proposal.shortfall > 0 && (
                      <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
                        <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                        <span>
                          {'tooShort' in proposal ? (
                            t.batchTooShort
                          ) : (
                            <>
                              {t.notEnough}{' '}
                              <Quantity
                                unit={saleUnit}
                                amount={proposal.takes.reduce(
                                  (sum, take) => sum + take.quantity,
                                  0,
                                )}
                              />
                            </>
                          )}
                        </span>
                      </p>
                    )}
                  </Field>
                  <Field className="gap-1.5">
                    <FieldLabel htmlFor={`${id}-${totalMode ? 'total' : 'price'}`}>
                      {totalMode
                        ? t.fields.totalPrice
                        : saleUnit === 'meter'
                          ? t.fields.pricePerMeter
                          : t.fields.pricePerPiece}
                    </FieldLabel>
                    {totalMode ? (
                      <MoneyInput id={`${id}-total`} value={totalCents} {...field('total')} />
                    ) : (
                      <MoneyInput id={`${id}-price`} value={unitPrice} {...field('price')} />
                    )}
                    {totalMode ? (
                      <div role="status" className="grid gap-0.5 text-sm text-muted-foreground">
                        {quantity === null ? (
                          <p>{t.line.enterQuantityFirst}</p>
                        ) : (
                          priceFromTotal !== null && (
                            <p>
                              {t.line.worksOutTo}{' '}
                              <span className="font-medium text-foreground">
                                <Money cents={priceFromTotal} /> / {unitLabel}
                              </span>
                            </p>
                          )
                        )}
                        {roundedTo !== null && (
                          <p>
                            {t.line.totalComesTo}{' '}
                            <span className="font-medium text-foreground">
                              <Money cents={roundedTo} />
                            </span>
                          </p>
                        )}
                      </div>
                    ) : (
                      <div
                        role="group"
                        aria-label={t.line.quickPrice}
                        className="flex flex-wrap gap-2"
                        onPointerDown={keepFocus}
                      >
                        {(
                          [
                            [t.line.referencePrice, normalCents],
                            [t.line.lowestPrice, minCents],
                          ] as const
                        ).map(([label, cents]) => (
                          <Button
                            key={label}
                            type="button"
                            variant="outline"
                            size="sm"
                            className="touch-manipulation pointer-coarse:px-4"
                            onClick={() => {
                              fill('price', format(cents));
                            }}
                          >
                            {label} · <Money cents={cents} />
                          </Button>
                        ))}
                      </div>
                    )}
                  </Field>
                  <Field orientation="horizontal">
                    <Checkbox
                      id={`${id}-by-total`}
                      checked={byTotal}
                      onCheckedChange={(checked) => {
                        changeByTotal(checked === true);
                      }}
                    />
                    <FieldLabel htmlFor={`${id}-by-total`}>{t.fields.byTotal(saleUnit)}</FieldLabel>
                  </Field>
                </>
              )}

              {batches && batches.length > 0 && (
                <Field className="gap-1.5">
                  <FieldLabel htmlFor={`${id}-batch`}>{t.fields.batch}</FieldLabel>
                  <Select
                    value={batchChoice}
                    onValueChange={(next) => {
                      setBatchChoice(next);
                      setWholePiece(false);
                    }}
                  >
                    <SelectTrigger id={`${id}-batch`} className="w-full pointer-coarse:h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={AUTO}>{t.fields.batchAuto}</SelectItem>
                      {batches.map((choice) => (
                        <SelectItem key={choice.batch.id} value={choice.batch.id}>
                          <BatchLabel
                            choice={choice}
                            unit={saleUnit}
                            taken={taken.get(choice.batch.id) ?? 0}
                          />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {proposed && (
                    <div className="flex flex-wrap items-center gap-1.5" role="status">
                      <span className="text-xs text-muted-foreground">
                        {t.splitAcross(proposed.takes.length)}
                      </span>
                      <ul className="flex flex-wrap gap-1.5">
                        {proposed.takes.map((take) => (
                          <li key={take.choice.batch.id}>
                            <Badge variant="secondary">
                              <bdi dir="ltr" data-num>
                                {take.choice.batch.code}
                              </bdi>
                              · <Quantity unit={saleUnit} amount={take.quantity} />
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </Field>
              )}

              {canSellWhole && (
                <Field orientation="horizontal">
                  <Switch
                    id={`${id}-whole-switch`}
                    checked={wholePiece}
                    onCheckedChange={(checked) => {
                      setWholePiece(checked);
                      if (checked) pad.activate('whole');
                    }}
                  />
                  <FieldLabel htmlFor={`${id}-whole-switch`}>{t.fields.wholePiece}</FieldLabel>
                </Field>
              )}
            </FieldGroup>

            {keypad && <Keypad onPress={pad.press} className="sticky top-0 self-start" />}
          </div>
        </div>

        {/* What needs the owner, next to the button it blocks: asked once, here. */}
        {(needsMinimum || needsCost) && (
          <div className="grid shrink-0 gap-2">
            {needsMinimum && (
              <Authorization
                title={t.minimum.title}
                detail={
                  <>
                    {t.minimum.price}: <Money cents={minCents} />
                  </>
                }
              >
                {owner === null ? (
                  <p className="text-sm">{t.minimum.cashier}</p>
                ) : (
                  <ConfirmSwitch
                    id={`${id}-confirm-minimum`}
                    checked={minConfirmed}
                    onChange={setMinConfirmed}
                    label={t.minimum.confirm}
                  />
                )}
              </Authorization>
            )}
            {needsCost && (
              <Authorization title={t.belowCostTitle}>
                <ConfirmSwitch
                  id={`${id}-confirm-cost`}
                  checked={costConfirmed}
                  onChange={setCostConfirmed}
                  label={t.confirmBelowCost}
                />
              </Authorization>
            )}
          </div>
        )}

        <DialogFooter className="shrink-0 flex-row flex-wrap items-center gap-x-3 gap-y-2 py-3 sm:justify-end">
          {/* The total: a row of its own on a phone, at the start of the footer from sm up. */}
          <div
            className="flex w-full items-baseline justify-between gap-3 sm:me-auto sm:grid sm:w-auto sm:min-w-24 sm:gap-0.5"
            role="status"
          >
            <span className="text-xs text-muted-foreground">{t.line.lineTotal}</span>
            <span className="text-xl leading-none font-semibold">
              {priced ? <Money cents={priced.totalCents} /> : '—'}
            </span>
          </div>
          <Button type="button" variant="outline" className="pointer-coarse:h-12" onClick={onClose}>
            {messages.forms.cancel}
          </Button>
          <Button
            type="button"
            variant="accent"
            className="pointer-coarse:h-12 pointer-coarse:px-6 max-sm:flex-1"
            disabled={!item || blocked}
            onClick={handleSubmit}
          >
            {editing ? t.line.update : t.addLine}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "B-A0001 · 49.7 m" (what is left after the rest of the bill). */
function BatchLabel({
  choice,
  unit,
  taken,
}: {
  choice: BatchChoice;
  unit: CartUnit;
  taken: number;
}) {
  const left = (unit === 'meter' ? choice.remainingCm : choice.remainingPieces) - taken;
  return (
    <span className="flex gap-2">
      <bdi dir="ltr" data-num>
        {choice.batch.code}
      </bdi>
      <span className="text-muted-foreground">
        <Quantity unit={unit} amount={left} />
      </span>
      {choice.state === 'remnant' && (
        <Badge variant="secondary">{messages.inventory.states.remnant}</Badge>
      )}
      {choice.ledger.measurementStatus === 'estimated' && (
        <Badge variant="warning">{messages.purchasing.estimated}</Badge>
      )}
    </span>
  );
}
