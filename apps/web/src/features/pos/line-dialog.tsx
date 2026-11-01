'use client';

import {
  formatLengthMeters,
  formatMoneyAmount,
  parseLengthInput,
  parseMoneyInput,
} from '@fabric/core';
import { TriangleAlertIcon } from 'lucide-react';
import { type PointerEvent, useId, useMemo, useState } from 'react';
import { messages } from '@/i18n';
import { type FabricStock, type RollChoice, useLiveQuery, useRepositories } from '@/local-db';
import {
  Keypad,
  LENGTH_PAD,
  MeterInput,
  Meters,
  Money,
  MoneyInput,
  moneyPad,
  useMoneyUnit,
  usePadFields,
} from '@/shared/format';
import { ProductPhoto } from '@/shared/brand';
import { shopToday } from '@/shared/lib/dates';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
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
  itemLengthCm,
  itemPrice,
  pricedItemOf,
  type SaleLineInput,
  withoutCode,
} from './cart';

const t = messages.pos;

/** A quick button must not take the focus from the field being typed in. */
const keepFocus = (event: PointerEvent<HTMLElement>) => {
  event.preventDefault();
};

/** Lengths a customer often asks for, in metres: one tap fills the field. */
const QUICK_LENGTHS = [2.5, 3] as const;

/**
 * Adds a colour to the bill, or changes a line already on it: the length and the price are
 * typed on the keypad (tap a field to type in it), the app proposes the roll(s) and shows the
 * line's total and warnings as they stand.
 */
export function LineDialog({
  fabricStock,
  variantId,
  photo,
  others,
  editing,
  seesCosts,
  onSubmit,
  onClose,
}: {
  fabricStock: FabricStock;
  variantId: string;
  /** The colour's picture (a data: URL), if it has one. */
  photo: string | undefined;
  /** The rest of the bill: it holds some of the rolls and is costed first. */
  others: readonly CartItem[];
  /** The line being changed (its own length is free for the proposal). */
  editing: CartItem | null;
  seesCosts: boolean;
  onSubmit: (item: CartItem) => void;
  onClose: () => void;
}) {
  const id = useId();
  const repositories = useRepositories();
  const { unit } = useMoneyUnit();
  const { fabric } = fabricStock;
  const color = fabricStock.colors.find((entry) => entry.variant.id === variantId);
  const variant = color?.variant;

  const editedPrice = editing ? itemPrice(editing) : undefined;
  const format = (cents: number) => formatMoneyAmount(cents, unit, { grouping: false });
  const pad = usePadFields<'length' | 'price' | 'piece'>(
    {
      length: editing ? formatLengthMeters(itemLengthCm(editing), { grouping: false }) : '',
      price: format(
        editedPrice && 'perMeterCents' in editedPrice
          ? editedPrice.perMeterCents
          : fabric.refPricePerMeterCents,
      ),
      piece: format(
        editedPrice && 'wholePieceCents' in editedPrice
          ? editedPrice.wholePieceCents
          : (fabric.piecePriceCents ?? 0),
      ),
    },
    { length: LENGTH_PAD, price: moneyPad(unit), piece: moneyPad(unit) },
    editedPrice && 'wholePieceCents' in editedPrice ? 'piece' : 'length',
  );
  const [rollChoice, setRollChoice] = useState(editing?.rollChoice ?? AUTO);
  const [wholePiece, setWholePiece] = useState(
    editedPrice !== undefined && 'wholePieceCents' in editedPrice,
  );

  const lengthParsed = parseLengthInput(pad.texts.length);
  const lengthCm = lengthParsed.ok ? lengthParsed.value : null;
  const priceParsed = parseMoneyInput(pad.texts.price, unit);
  const pricePerMeter = priceParsed.ok ? priceParsed.value : null;
  const pieceParsed = parseMoneyInput(pad.texts.piece, unit);
  const piecePrice = pieceParsed.ok ? pieceParsed.value : null;

  /** cm of each roll the rest of the bill already holds, so this line is proposed what is left. */
  const taken = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of others.flatMap((entry) => entry.lines)) {
      map.set(line.rollId, (map.get(line.rollId) ?? 0) + line.soldCm);
    }
    return map;
  }, [others]);

  const rolls = useLiveQuery(
    () => repositories.sales.rollsOfColor(variantId),
    [repositories, variantId],
  );
  const chosen = rolls?.find((choice) => choice.roll.id === rollChoice);
  const canSellWhole =
    fabric.sellableAsPiece &&
    chosen !== undefined &&
    chosen.untouched &&
    !taken.has(chosen.roll.id);
  const piece = wholePiece && canSellWhole;
  const selling = piece ? chosen.ledger.remainingCm : lengthCm;

  const proposal = useLiveQuery(async () => {
    if (selling === null || selling <= 0) return null;
    if (chosen) {
      const left = chosen.ledger.remainingCm - (taken.get(chosen.roll.id) ?? 0);
      return left >= selling
        ? { takes: [{ rollId: chosen.roll.id, cm: selling, choice: chosen }], shortCm: 0 }
        : { takes: [], shortCm: selling, tooShort: true };
    }
    return repositories.sales.propose(variantId, selling, taken);
  }, [repositories, variantId, selling, chosen, taken]);

  const priceCents = piece ? piecePrice : pricePerMeter;
  const item = useMemo((): CartItem | null => {
    if (
      !variant ||
      !proposal ||
      proposal.shortCm > 0 ||
      proposal.takes.length === 0 ||
      priceCents === null
    ) {
      return null;
    }
    const price: SaleLineInput['price'] = piece
      ? { wholePieceCents: priceCents }
      : { perMeterCents: priceCents };
    return {
      key: editing?.key ?? crypto.randomUUID(),
      fabric,
      variant,
      rollChoice,
      lines: proposal.takes.map((take) => ({
        rollId: take.rollId,
        rollCode: take.choice.roll.shortCode,
        soldCm: take.cm,
        price,
        refPricePerMeterCents: fabric.refPricePerMeterCents,
        minPricePerMeterCents: fabric.minPricePerMeterCents,
      })),
    };
  }, [fabric, variant, proposal, priceCents, piece, rollChoice, editing]);

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

  if (!variant) return null;

  const handleSubmit = () => {
    if (!item) return;
    onSubmit(item);
  };

  const field = (name: 'length' | 'price' | 'piece') => ({
    keypad: true,
    large: true,
    text: pad.texts[name],
    onTextChange: (text: string) => {
      pad.type(name, text);
    },
    onFocus: () => {
      pad.activate(name);
    },
  });
  /** A quick button fills a field and moves the typing there (the keyboard too). */
  const fill = (name: 'length' | 'price' | 'piece', text: string) => {
    pad.fill(name, text);
    document.getElementById(`${id}-${name}`)?.focus();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[calc(100svh-2rem)] flex-col gap-3 overflow-hidden sm:max-w-xl md:max-w-3xl"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing && !event.repeat) {
            event.preventDefault();
            handleSubmit();
          }
        }}
      >
        {' '}
        <DialogHeader className="flex-row items-center gap-3 pe-10">
          <ProductPhoto src={photo} className="size-14 rounded-lg" />
          <div className="grid min-w-0 gap-1">
            <DialogTitle>
              {fabric.name} · {variant.colorName}
            </DialogTitle>
            <DialogDescription>
              {t.available}: <Meters cm={color.remainingCm} /> · {t.reference}:{' '}
              <Money cents={fabric.refPricePerMeterCents} />
            </DialogDescription>
          </div>
        </DialogHeader>
        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4">
          {/* Fields, then the keypad, then the details; side by side from md up. */}
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_17rem] md:grid-rows-[auto_1fr]">
            <FieldGroup>
              {piece ? (
                <Field>
                  <FieldLabel htmlFor={`${id}-piece`}>{t.fields.piecePrice}</FieldLabel>
                  <MoneyInput id={`${id}-piece`} value={piecePrice} {...field('piece')} />
                </Field>
              ) : (
                <>
                  <Field>
                    <FieldLabel htmlFor={`${id}-length`}>{t.fields.length}</FieldLabel>
                    <MeterInput id={`${id}-length`} value={lengthCm} {...field('length')} />
                    <div
                      role="group"
                      aria-label={t.line.quickLength}
                      className="flex flex-wrap gap-2"
                      onPointerDown={keepFocus}
                    >
                      {QUICK_LENGTHS.map((meters) => (
                        <Button
                          key={meters}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="touch-manipulation pointer-coarse:h-11 pointer-coarse:px-4"
                          onClick={() => {
                            fill('length', String(meters));
                          }}
                        >
                          {meters} {messages.units.meter}
                        </Button>
                      ))}
                    </div>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${id}-price`}>{t.fields.pricePerMeter}</FieldLabel>
                    <MoneyInput id={`${id}-price`} value={pricePerMeter} {...field('price')} />
                    <div
                      role="group"
                      aria-label={t.line.quickPrice}
                      className="flex flex-wrap gap-2"
                      onPointerDown={keepFocus}
                    >
                      {(
                        [
                          [t.line.referencePrice, fabric.refPricePerMeterCents],
                          [t.line.lowestPrice, fabric.minPricePerMeterCents],
                        ] as const
                      ).map(([label, cents]) => (
                        <Button
                          key={label}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="touch-manipulation pointer-coarse:h-11 pointer-coarse:px-4"
                          onClick={() => {
                            fill('price', format(cents));
                          }}
                        >
                          {label} · <Money cents={cents} />
                        </Button>
                      ))}
                    </div>
                  </Field>
                </>
              )}
            </FieldGroup>

            <Keypad
              onPress={pad.press}
              className="md:col-start-2 md:row-span-2 md:row-start-1 md:self-start"
            />

            <div className="grid content-start gap-3">
              <FieldGroup>
                {rolls && rolls.length > 0 && (
                  <Field>
                    <FieldLabel htmlFor={`${id}-roll`}>{t.fields.roll}</FieldLabel>
                    <Select
                      value={rollChoice}
                      onValueChange={(next) => {
                        setRollChoice(next);
                        setWholePiece(false);
                      }}
                    >
                      <SelectTrigger id={`${id}-roll`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={AUTO}>{t.fields.rollAuto}</SelectItem>
                        {rolls.map((choice) => (
                          <SelectItem key={choice.roll.id} value={choice.roll.id}>
                            <RollLabel choice={choice} taken={taken.get(choice.roll.id) ?? 0} />
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}

                {canSellWhole && (
                  <Field orientation="horizontal">
                    <Switch
                      id={`${id}-whole`}
                      checked={wholePiece}
                      onCheckedChange={(checked) => {
                        setWholePiece(checked);
                        if (checked) pad.activate('piece');
                      }}
                    />
                    <FieldLabel htmlFor={`${id}-whole`}>{t.fields.wholePiece}</FieldLabel>
                  </Field>
                )}
              </FieldGroup>

              {proposal && proposal.takes.length > 0 && (
                <div className="grid gap-1 text-sm" role="status">
                  <span className="text-muted-foreground">
                    {t.splitAcross(proposal.takes.length)}
                  </span>
                  <ul className="flex flex-wrap gap-2">
                    {proposal.takes.map((take) => (
                      <li key={take.rollId}>
                        <Badge variant="secondary">
                          <bdi dir="ltr" data-num>
                            {take.choice.roll.shortCode}
                          </bdi>
                          · <Meters cm={take.cm} />
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {proposal && proposal.shortCm > 0 && (
                <Alert variant="destructive">
                  <TriangleAlertIcon aria-hidden />
                  <AlertDescription>
                    {'tooShort' in proposal ? (
                      t.rollTooShort
                    ) : (
                      <>
                        {t.notEnough}{' '}
                        <Meters cm={proposal.takes.reduce((sum, take) => sum + take.cm, 0)} />
                      </>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {priced && (
                <div className="grid gap-1.5 rounded-lg bg-muted p-3" role="status">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-muted-foreground">{t.line.lineTotal}</span>
                    <span className="text-2xl font-semibold">
                      <Money cents={priced.totalCents} />
                    </span>
                  </div>
                  {priced.warnings.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {priced.warnings.map((warning) => (
                        <Badge
                          key={warning}
                          variant={warning === 'below_cost' ? 'destructive' : 'warning'}
                        >
                          {t.warnings[warning]}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {seesCosts && (
                    <span className="text-sm text-muted-foreground">
                      {t.profit}:{' '}
                      <Money
                        cents={priced.profitCents}
                        tone={priced.profitCents < 0 ? 'loss' : 'profit'}
                      />
                      {priced.provisional && ` · ${t.provisional}`}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {messages.forms.cancel}
          </Button>
          <Button type="button" variant="accent" disabled={!item} onClick={handleSubmit}>
            {editing ? t.line.update : t.addLine}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "R-A0001 · 49.7 m" (what is left after the rest of the bill). */
function RollLabel({ choice, taken }: { choice: RollChoice; taken: number }) {
  return (
    <span className="flex gap-2">
      <bdi dir="ltr" data-num>
        {choice.roll.shortCode}
      </bdi>
      <span className="text-muted-foreground">
        <Meters cm={choice.ledger.remainingCm - taken} />
      </span>
      {choice.state === 'remnant' && (
        <Badge variant="secondary">{messages.inventory.states.remnant}</Badge>
      )}
      {choice.ledger.lengthEstimated && (
        <Badge variant="warning">{messages.purchasing.estimated}</Badge>
      )}
    </span>
  );
}
