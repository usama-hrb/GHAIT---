'use client';

import type { Customer, PricedSale } from '@fabric/contracts';
import { PencilIcon, ReceiptTextIcon, Trash2Icon, TriangleAlertIcon } from 'lucide-react';
import { messages } from '@/i18n';
import type { Local } from '@/local-db';
import { Meters, Money } from '@/shared/format';
import { ProductPhoto } from '@/shared/brand';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { type CartItem, itemLengthCm, itemPrice, type PricedItem } from './cart';
import { CustomerPicker } from './customer-picker';

const t = messages.pos;

/**
 * The bill at the side (SPEC §4): its customer, a card per thing bought (tap it to change the
 * length or the price), the discount, the total and the one big Pay button. A cashier sees no
 * cost or profit (SPEC §11).
 */
export function BillPanel({
  items,
  priced,
  seesCosts,
  photos,
  customers,
  customerId,
  onCustomer,
  onAddCustomer,
  discount,
  onDiscount,
  onEdit,
  onRemove,
  onClear,
  onPay,
  issue,
  onPartialPay,
}: {
  items: readonly PricedItem[];
  priced: PricedSale | null | undefined;
  seesCosts: boolean;
  /** Each colour's picture (a data: URL), by variant id. */
  photos: ReadonlyMap<string, string>;
  customers: readonly Local<Customer>[];
  customerId: string | null;
  onCustomer: (id: string | null) => void;
  onAddCustomer: () => void;
  discount: number | null;
  onDiscount: () => void;
  onEdit: (item: CartItem) => void;
  onRemove: (item: CartItem) => void;
  onClear: () => void;
  onPay: () => void;
  onPartialPay: () => void;
  /** Why the bill cannot be paid yet (a discount above the total…), already worded. */
  issue: string | undefined;
}) {
  const split = priced?.split ?? null;
  const total = split?.totalCents ?? null;
  const empty = items.length === 0;

  return (
    <section
      aria-label={t.cart}
      className="flex h-full min-h-0 flex-col rounded-xl border border-border/70 bg-card text-card-foreground shadow-sm"
    >
      <header className="flex items-center gap-2 border-b border-dashed border-border px-3 py-3">
        <ReceiptTextIcon className="size-5 text-muted-foreground" aria-hidden />
        <h3 className="font-heading text-sm font-semibold tracking-tight">{t.cart}</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {t.bill.items(items.length)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ms-auto"
          disabled={empty}
          onClick={onClear}
        >
          {t.bill.clear}
        </Button>
      </header>

      <div className="grid gap-2 border-b border-dashed border-border p-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {t.fields.customer}
        </span>
        <CustomerPicker
          customers={customers}
          customerId={customerId}
          onCustomer={onCustomer}
          onAdd={onAddCustomer}
        />
      </div>

      {empty ? (
        <p className="flex-1 p-6 text-center text-muted-foreground">{t.bill.empty}</p>
      ) : (
        <ul className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto p-3">
          {items.map(({ item, totalCents, profitCents, warnings, provisional }) => {
            const price = itemPrice(item);
            return (
              <li
                key={item.key}
                className="group grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-dotted border-border/80 bg-background p-3 transition-colors hover:border-primary/30 hover:bg-muted/20"
              >
                {/* Product image */}
                <ProductPhoto
                  src={photos.get(item.variant.id)}
                  className="size-12 shrink-0 rounded-md"
                />

                {/* Product information */}
                <button
                  type="button"
                  aria-label={`${t.bill.edit}: ${item.fabric.name} · ${item.variant.colorName}`}
                  className="flex min-w-0 flex-col justify-center gap-1.5 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  onClick={() => onEdit(item)}
                >
                  {/* Product name */}
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">
                      {item.fabric.name} · {item.variant.colorName}
                    </span>
                    <PencilIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  </span>

                  {/* Length and unit price */}
                  <span className="text-xs font-medium text-muted-foreground tabular-nums">
                    {price && 'wholePieceCents' in price ? (
                      <>
                        {t.bill.wholePiece} · <Meters cm={itemLengthCm(item)} />
                      </>
                    ) : (
                      <>
                        <Meters cm={itemLengthCm(item)} />
                        {price && 'perMeterCents' in price && (
                          <>
                            {' × '}
                            <Money cents={price.perMeterCents} />
                          </>
                        )}
                      </>
                    )}
                  </span>

                  {item.lines.length > 1 && (
                    <span className="text-xs text-muted-foreground">
                      {t.splitAcross(item.lines.length)}
                    </span>
                  )}

                  {warnings.length > 0 && (
                    <span className="flex flex-wrap gap-1">
                      {warnings.map((warning) => (
                        <Badge
                          key={warning}
                          variant={warning === 'below_cost' ? 'destructive' : 'warning'}
                        >
                          {t.warnings[warning]}
                        </Badge>
                      ))}
                    </span>
                  )}

                  {seesCosts && (
                    <span className="text-xs text-muted-foreground">
                      {t.profit}:{' '}
                      <Money cents={profitCents} tone={profitCents < 0 ? 'loss' : 'profit'} />
                      {provisional && ` · ${t.provisional}`}
                    </span>
                  )}
                </button>

                {/* Total and remove action */}
                <div className="flex h-full min-w-[76px] flex-col items-end justify-between gap-2">
                  <span className="whitespace-nowrap text-sm font-bold tabular-nums">
                    <Money cents={totalCents} />
                  </span>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-destructive"
                    aria-label={`${t.remove}: ${item.fabric.name} · ${item.variant.colorName}`}
                    onClick={() => onRemove(item)}
                  >
                    <Trash2Icon className="size-4" aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <footer className="grid gap-3 border-t border-dashed border-border bg-muted/10 p-3">
        <dl className="grid gap-1.5">
          {split && split.discountCents > 0 && (
            <div className="flex items-baseline justify-between gap-2 border-t border-dashed border-border pt-3">
              <dt className="text-sm font-semibold uppercase tracking-wide">{t.total}</dt>{' '}
              <dd className="font-heading text-2xl font-bold tabular-nums tracking-tight">
                {total === null ? '—' : <Money cents={total} />}
              </dd>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 text-sm">
            <dt className="text-muted-foreground">{t.bill.discount}</dt>
            <dd>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={empty}
                onClick={onDiscount}
                aria-label={discount === null ? t.bill.addDiscount : t.bill.editDiscount}
              >
                {discount === null ? t.bill.addDiscount : <Money cents={discount} />}
                <PencilIcon aria-hidden />
              </Button>
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-2 text-2xl font-semibold">
            <dt>{t.total}</dt>
            <dd>{total === null ? '—' : <Money cents={total} />}</dd>
          </div>
          {seesCosts && split && (
            <div className="flex justify-between gap-2 text-sm">
              <dt className="text-muted-foreground">{t.profit}</dt>
              <dd>
                <Money cents={split.profitCents} tone={split.profitCents < 0 ? 'loss' : 'profit'} />
              </dd>
            </div>
          )}
        </dl>
        {issue && (
          <p role="alert" className="text-sm text-destructive">
            {issue}
          </p>
        )}
        {priced?.requiresConfirmation && (
          <p className="flex items-start gap-2 text-sm text-destructive">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t.bill.belowCost}
          </p>
        )}
        <div className="grid gap-2">
          <Button
            type="button"
            variant="accent"
            size="lg"
            className="h-12 w-full text-base font-semibold shadow-sm"
            disabled={empty || issue !== undefined || total === null}
            onClick={onPay}
          >
            {t.bill.pay}
            {total !== null && (
              <>
                {' '}
                · <Money cents={total} />
              </>
            )}
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={onPartialPay}
            disabled={empty || issue !== undefined || total === null}
            className="h-10 w-full border-dashed"
          >
            {t.bill.partialPay}
          </Button>
        </div>
      </footer>
    </section>
  );
}
