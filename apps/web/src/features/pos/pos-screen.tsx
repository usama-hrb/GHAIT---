'use client';

import type { Fabric, NewSaleInput, Variant } from '@fabric/contracts';
import type { PriceWarning } from '@fabric/core';
import { PackageIcon, Trash2Icon, TriangleAlertIcon, UserPlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CustomerDialog } from '@/features/customers';
import { messages } from '@/i18n';
import {
  type Local,
  type RollChoice,
  useLiveQuery,
  useRepositories,
  useSession,
  ValidationError,
} from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice } from '@/shared/brand';
import { MeterInput, Meters, Money, MoneyInput } from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';
import { useAppNavigation } from '@/shared/lib/navigation';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Combobox } from '@/shared/ui/combobox';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Switch } from '@/shared/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

const t = messages.pos;
const AUTO = 'auto';

type SaleLineInput = NewSaleInput['lines'][number];

/** One thing the customer buys: a colour and a length, cut from one roll or more. */
interface CartItem {
  key: string;
  fabric: Local<Fabric>;
  variant: Local<Variant>;
  lines: (SaleLineInput & { rollCode: string })[];
}

const withoutCode = ({
  rollId,
  soldCm,
  price,
  refPricePerMeterCents,
  minPricePerMeterCents,
}: CartItem['lines'][number]): SaleLineInput => ({
  rollId,
  soldCm,
  price,
  refPricePerMeterCents,
  minPricePerMeterCents,
});

const issueText = (message: string | undefined) =>
  (message && t.issues[message]) ?? messages.forms.invalid;

/**
 * The POS (SPEC §4, §14.5, BUILD_PROMPTS 3.4): colour → length → proposed roll(s) → price →
 * cart → customer → paid or credit → save → share. Every figure comes from @fabric/core through
 * the sales repository; everything is saved on the device first.
 */
export function PosScreen() {
  const id = useId();
  const repositories = useRepositories();
  const navigation = useAppNavigation();
  const session = useSession();
  const isOwner = session.user?.role === 'owner';

  const stock = useLiveQuery(() => repositories.inventory.overview(), [repositories]);
  const customers = useLiveQuery(() => repositories.customers.list(), [repositories]);

  // The line being entered.
  const [fabricId, setFabricId] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [lengthCm, setLengthCm] = useState<number | null>(null);
  const [pricePerMeter, setPricePerMeter] = useState<number | null>(null);
  const [rollChoice, setRollChoice] = useState<string>(AUTO);
  const [wholePiece, setWholePiece] = useState(false);
  const [piecePrice, setPiecePrice] = useState<number | null>(null);
  const [lineAttempted, setLineAttempted] = useState(false);

  // The invoice.
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState<number | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [mode, setMode] = useState<'full' | 'credit'>('full');
  const [paid, setPaid] = useState<number | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addingCustomer, setAddingCustomer] = useState(false);

  const fabricStock = stock?.fabrics.find((entry) => entry.fabric.id === fabricId);
  const fabric = fabricStock?.fabric;
  const variant = fabricStock?.colors.find((color) => color.variant.id === variantId)?.variant;

  /** cm of each roll already in the cart, so a second line is proposed what is left. */
  const taken = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of cart.flatMap((item) => item.lines)) {
      map.set(line.rollId, (map.get(line.rollId) ?? 0) + line.soldCm);
    }
    return map;
  }, [cart]);

  const rolls = useLiveQuery(
    async () => (variantId ? repositories.sales.rollsOfColor(variantId) : []),
    [repositories, variantId],
  );
  const chosen = rolls?.find((choice) => choice.roll.id === rollChoice);
  const canSellWhole =
    fabric?.sellableAsPiece === true &&
    chosen !== undefined &&
    chosen.untouched &&
    !taken.has(chosen.roll.id);
  const selling = wholePiece && canSellWhole ? chosen.ledger.remainingCm : lengthCm;

  const proposal = useLiveQuery(async () => {
    if (!variantId || selling === null || selling <= 0) return null;
    if (chosen) {
      const left = chosen.ledger.remainingCm - (taken.get(chosen.roll.id) ?? 0);
      return left >= selling
        ? { takes: [{ rollId: chosen.roll.id, cm: selling, choice: chosen }], shortCm: 0 }
        : { takes: [], shortCm: selling, tooShort: true };
    }
    return repositories.sales.propose(variantId, selling, taken);
  }, [repositories, variantId, selling, chosen, taken]);

  const input = useMemo((): NewSaleInput | null => {
    const lines = cart.flatMap((item) => item.lines.map(withoutCode));
    if (lines.length === 0) return null;
    return {
      date: shopToday(),
      customerId,
      lines,
      discountCents: discount ?? 0,
      paidCents: 0,
      dueDate: mode === 'credit' && dueDate !== '' ? dueDate : null,
      confirmedBelowCost: confirmed,
      note: note.trim() === '' ? null : note,
    };
  }, [cart, customerId, discount, mode, dueDate, confirmed, note]);

  // Priced as if nothing were paid yet: the total and warnings do not depend on the payment.
  const priced = useLiveQuery(
    async () => (input ? repositories.sales.preview(input) : null),
    [repositories, input],
  );

  if (stock === undefined || customers === undefined) return <LoadingState />;
  const inStock = stock.fabrics.filter((entry) => entry.remainingCm > 0);
  if (inStock.length === 0 && cart.length === 0) {
    return (
      <EmptyState
        icon={PackageIcon}
        title={t.noStock}
        action={
          <Button asChild>
            <Link href="/purchases/new">{t.newPurchase}</Link>
          </Button>
        }
      />
    );
  }

  const total = priced?.split?.totalCents ?? null;
  const paidCents = mode === 'full' ? total : paid;
  const invoiceIssue = priced?.issues.find(
    (issue) => issue.message !== 'sale_credit_needs_customer',
  )?.message;
  const creditWithoutCustomer = mode === 'credit' && customerId === null;

  const resetLine = () => {
    setVariantId(null);
    setLengthCm(null);
    setRollChoice(AUTO);
    setWholePiece(false);
    setPiecePrice(null);
    setLineAttempted(false);
  };

  const chooseFabric = (next: string | null) => {
    const picked = stock.fabrics.find((entry) => entry.fabric.id === next)?.fabric;
    setFabricId(next);
    setPricePerMeter(picked?.refPricePerMeterCents ?? null);
    resetLine();
  };

  const addLine = () => {
    setLineAttempted(true);
    if (!fabric || !variant || !proposal || proposal.shortCm > 0 || proposal.takes.length === 0)
      return;
    const whole = wholePiece && canSellWhole;
    const price = whole
      ? { wholePieceCents: piecePrice ?? fabric.piecePriceCents ?? 0 }
      : pricePerMeter === null
        ? null
        : { perMeterCents: pricePerMeter };
    if (!price) return;
    setCart((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        fabric,
        variant,
        lines: proposal.takes.map((take) => ({
          rollId: take.rollId,
          rollCode: take.choice.roll.shortCode,
          soldCm: take.cm,
          price,
          refPricePerMeterCents: fabric.refPricePerMeterCents,
          minPricePerMeterCents: fabric.minPricePerMeterCents,
        })),
      },
    ]);
    setConfirmed(false);
    resetLine();
  };

  const save = () => {
    setAttempted(true);
    if (!input || paidCents === null || creditWithoutCustomer) return;
    if (priced?.requiresConfirmation && !confirmed) return;
    setSaving(true);
    repositories.sales
      .create({ ...input, paidCents })
      .then((saleId) => {
        toast.success(t.saved, { description: messages.forms.saved });
        navigation.push(`/pos/view?id=${saleId}`);
      })
      .catch((error: unknown) => {
        setSaving(false);
        toast.error(
          error instanceof ValidationError
            ? issueText(error.issues[0]?.message)
            : messages.forms.invalid,
        );
      });
  };

  // Per cart item, the priced lines it became (priced.lines follows the input's line order).
  const starts = cart.map((_, index) =>
    cart.slice(0, index).reduce((sum, item) => sum + item.lines.length, 0),
  );
  const pricedItems = cart.map((item, index) => {
    const start = starts[index] ?? 0;
    const lines = priced?.lines.slice(start, start + item.lines.length) ?? [];
    return {
      item,
      totalCents: lines.reduce((sum, line) => sum + line.lineTotalCents, 0),
      profitCents: lines.reduce((sum, line) => sum + line.profitCents, 0),
      warnings: [...new Set(lines.flatMap((line) => line.warnings))] as PriceWarning[],
      provisional: lines.some((line) => line.costing.provisional),
    };
  });

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4">
      <OfflineNotice />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-xl font-semibold">{t.title}</h2>
        <Button asChild variant="outline">
          <Link href="/pos/history">{t.history}</Link>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid content-start gap-4">
          <form
            noValidate
            aria-label={t.addLine}
            className="grid gap-4 rounded-xl border bg-card p-4"
            onSubmit={(event) => {
              event.preventDefault();
              addLine();
            }}
          >
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor={`${id}-fabric`}>{t.fields.fabric}</FieldLabel>
                  <Combobox
                    id={`${id}-fabric`}
                    options={inStock.map((entry) => ({
                      value: entry.fabric.id,
                      label: entry.fabric.name,
                    }))}
                    value={fabricId}
                    onValueChange={chooseFabric}
                    placeholder={t.fields.fabricPlaceholder}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-color`}>{t.fields.color}</FieldLabel>
                  <Combobox
                    id={`${id}-color`}
                    options={(fabricStock?.colors ?? [])
                      .filter((color) => color.remainingCm > 0)
                      .map((color) => ({
                        value: color.variant.id,
                        label: color.variant.colorName,
                      }))}
                    value={variantId}
                    onValueChange={(next) => {
                      resetLine();
                      setVariantId(next);
                    }}
                    placeholder={t.fields.colorPlaceholder}
                  />
                </Field>
              </div>

              {variantId && rolls && (
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
                      setPiecePrice(fabric.piecePriceCents);
                    }}
                  />
                  <FieldLabel htmlFor={`${id}-whole`}>{t.fields.wholePiece}</FieldLabel>
                </Field>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                {wholePiece && canSellWhole ? (
                  <Field>
                    <FieldLabel htmlFor={`${id}-piece-price`}>{t.fields.piecePrice}</FieldLabel>
                    <MoneyInput
                      id={`${id}-piece-price`}
                      required
                      showError={lineAttempted}
                      value={piecePrice}
                      onValueChange={setPiecePrice}
                    />
                  </Field>
                ) : (
                  <>
                    <Field>
                      <FieldLabel htmlFor={`${id}-length`}>{t.fields.length}</FieldLabel>
                      <MeterInput
                        id={`${id}-length`}
                        required
                        showError={lineAttempted}
                        value={lengthCm}
                        onValueChange={setLengthCm}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`${id}-price`}>{t.fields.pricePerMeter}</FieldLabel>
                      <MoneyInput
                        id={`${id}-price`}
                        required
                        showError={lineAttempted}
                        value={pricePerMeter}
                        onValueChange={setPricePerMeter}
                      />
                      {fabric && (
                        <p className="text-sm text-muted-foreground">
                          {t.reference}: <Money cents={fabric.refPricePerMeterCents} />
                        </p>
                      )}
                    </Field>
                  </>
                )}
              </div>

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
            </FieldGroup>
            <Button type="submit" variant="outline" className="justify-self-start">
              {t.addLine}
            </Button>
          </form>

          <section aria-label={t.cart} className="rounded-xl border bg-card">
            {cart.length === 0 ? (
              <p className="p-4 text-muted-foreground">{t.cartEmpty}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.columns.item}</TableHead>
                    <TableHead>{t.columns.roll}</TableHead>
                    <TableHead className="text-end">{t.columns.length}</TableHead>
                    <TableHead className="text-end">{t.columns.total}</TableHead>
                    {isOwner && (
                      <TableHead className="text-end max-sm:hidden">{t.columns.profit}</TableHead>
                    )}
                    <TableHead>
                      <span className="sr-only">{t.remove}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pricedItems.map(({ item, totalCents, profitCents, warnings, provisional }) => (
                    <TableRow key={item.key}>
                      <TableCell>
                        <div className="font-medium">
                          {item.fabric.name} · {item.variant.colorName}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {warnings.map((warning) => (
                            <Badge
                              key={warning}
                              variant={warning === 'below_cost' ? 'destructive' : 'warning'}
                            >
                              {t.warnings[warning]}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        {item.lines.map((line) => (
                          <bdi key={line.rollId} dir="ltr" data-num className="block">
                            {line.rollCode}
                          </bdi>
                        ))}
                      </TableCell>
                      <TableCell className="text-end">
                        <Meters cm={item.lines.reduce((sum, line) => sum + line.soldCm, 0)} />
                      </TableCell>
                      <TableCell className="text-end">
                        <Money cents={totalCents} />
                      </TableCell>
                      {isOwner && (
                        <TableCell className="text-end max-sm:hidden">
                          <Money cents={profitCents} tone={profitCents < 0 ? 'loss' : 'profit'} />
                          {provisional && (
                            <span className="block text-xs text-muted-foreground">
                              {t.provisional}
                            </span>
                          )}
                        </TableCell>
                      )}
                      <TableCell className="text-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t.remove}
                          onClick={() => {
                            setCart((current) => current.filter((entry) => entry.key !== item.key));
                            setConfirmed(false);
                          }}
                        >
                          <Trash2Icon aria-hidden />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </div>

        <form
          noValidate
          aria-label={t.cart}
          className="grid content-start gap-4 rounded-xl border bg-card p-4"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${id}-discount`}>
                {t.fields.discount}{' '}
                <span className="text-muted-foreground">({messages.forms.optional})</span>
              </FieldLabel>
              <MoneyInput id={`${id}-discount`} value={discount} onValueChange={setDiscount} />
            </Field>

            <dl className="grid gap-1">
              {priced?.split && priced.split.discountCents > 0 && (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t.linesTotal}</dt>
                  <dd>
                    <Money cents={priced.split.linesTotalCents} />
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-2 text-lg font-semibold">
                <dt>{t.total}</dt>
                <dd>{total === null ? '—' : <Money cents={total} />}</dd>
              </div>
              {isOwner && priced?.split && (
                <div className="flex justify-between gap-2 text-sm">
                  <dt className="text-muted-foreground">{t.profit}</dt>
                  <dd>
                    <Money
                      cents={priced.split.profitCents}
                      tone={priced.split.profitCents < 0 ? 'loss' : 'profit'}
                    />
                  </dd>
                </div>
              )}
            </dl>
            {invoiceIssue && (
              <p role="alert" className="text-sm text-destructive">
                {issueText(invoiceIssue)}
              </p>
            )}

            <Field data-invalid={(attempted && creditWithoutCustomer) || undefined}>
              <FieldLabel htmlFor={`${id}-customer`}>{t.fields.customer}</FieldLabel>
              <div className="flex gap-2">
                <Combobox
                  id={`${id}-customer`}
                  options={customers.map((customer) => ({
                    value: customer.id,
                    label: customer.phone ? `${customer.name} · ${customer.phone}` : customer.name,
                  }))}
                  value={customerId}
                  onValueChange={setCustomerId}
                  placeholder={t.fields.customerPlaceholder}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={messages.customers.add}
                  onClick={() => {
                    setAddingCustomer(true);
                  }}
                >
                  <UserPlusIcon aria-hidden />
                </Button>
              </div>
              {attempted && creditWithoutCustomer && (
                <FieldError>{t.issues.sale_credit_needs_customer}</FieldError>
              )}
            </Field>

            <RadioGroup
              value={mode}
              onValueChange={(next) => {
                setMode(next as 'full' | 'credit');
              }}
              className="grid gap-2"
            >
              {(['full', 'credit'] as const).map((option) => (
                <Field key={option} orientation="horizontal">
                  <RadioGroupItem id={`${id}-${option}`} value={option} />
                  <FieldLabel htmlFor={`${id}-${option}`}>{t.payment[option]}</FieldLabel>
                </Field>
              ))}
            </RadioGroup>

            {mode === 'credit' && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor={`${id}-paid`}>{t.fields.paid}</FieldLabel>
                  <MoneyInput
                    id={`${id}-paid`}
                    required
                    showError={attempted}
                    value={paid}
                    onValueChange={setPaid}
                  />
                  {total !== null && paid !== null && paid <= total && (
                    <p className="text-sm text-muted-foreground">
                      {t.remaining}: <Money cents={total - paid} tone="debt" />
                    </p>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-due`}>
                    {t.fields.dueDate}{' '}
                    <span className="text-muted-foreground">({messages.forms.optional})</span>
                  </FieldLabel>
                  <Input
                    id={`${id}-due`}
                    type="date"
                    value={dueDate}
                    onChange={(event) => {
                      setDueDate(event.target.value);
                    }}
                  />
                </Field>
              </div>
            )}

            <Field>
              <FieldLabel htmlFor={`${id}-note`}>
                {t.fields.note}{' '}
                <span className="text-muted-foreground">({messages.forms.optional})</span>
              </FieldLabel>
              <Input
                id={`${id}-note`}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
            </Field>

            {priced?.requiresConfirmation && (
              <Alert variant="destructive">
                <TriangleAlertIcon aria-hidden />
                <AlertTitle>{t.belowCostTitle}</AlertTitle>
                <AlertDescription className="grid gap-2">
                  <span>{t.belowCostDescription}</span>
                  <span className="flex items-center gap-2">
                    <Checkbox
                      id={`${id}-confirm`}
                      checked={confirmed}
                      onCheckedChange={(checked) => {
                        setConfirmed(checked === true);
                      }}
                    />
                    <label htmlFor={`${id}-confirm`} className="font-medium text-foreground">
                      {t.confirmBelowCost}
                    </label>
                  </span>
                </AlertDescription>
              </Alert>
            )}
          </FieldGroup>
          <Button
            type="submit"
            variant="accent"
            size="lg"
            disabled={
              saving ||
              cart.length === 0 ||
              invoiceIssue !== undefined ||
              (priced?.requiresConfirmation === true && !confirmed)
            }
          >
            {saving ? messages.forms.saving : t.save}
          </Button>
        </form>
      </div>

      <CustomerDialog
        open={addingCustomer}
        onOpenChange={setAddingCustomer}
        onSaved={setCustomerId}
      />
    </div>
  );
}

/** "R-A0001 · 49.7 م" (what is left after the cart's lines). */
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
