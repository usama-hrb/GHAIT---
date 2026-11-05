'use client';

import type { Customer, PricedSale } from '@fabric/contracts';
import { PencilIcon, ReceiptTextIcon, Trash2Icon } from 'lucide-react';
import { messages } from '@/i18n';
import type { Local } from '@/local-db';
import { Money, Quantity } from '@/shared/format';
import { ProductPhoto } from '@/shared/brand';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { type CartItem, itemOverrideBy, itemPrice, itemQuantity, type PricedItem } from './cart';
import { CustomerPicker } from './customer-picker';

const t = messages.pos;

/**
 * The bill at the side (SPEC §4): its customer, a card per thing bought (tap it to change the
 * length or the price), the discount, the total and the one big Pay button. No cost and no profit
 * is shown here, to anyone: the till sells; the profit is read in the reports (SPEC §11).
 */
export function BillPanel({
  items,
  priced,
  saving,
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
  /** A sale is being saved: paying again waits for it. */
  saving: boolean;
  /** Each product's picture (a data: URL), by product id. */
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
          {items.map(({ item, totalCents, belowCost }) => {
            const price = itemPrice(item);
            return (
              <li
                key={item.key}
                className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border border-border/80 bg-background p-2"
              >
                {/* Product image */}
                <ProductPhoto
                  src={photos.get(item.product.id)}
                  className="size-11 shrink-0 rounded-md"
                />

                {/* Product information */}
                <button
                  type="button"
                  aria-label={`${t.bill.edit}: ${item.product.name}`}
                  className="flex min-h-11 min-w-0 flex-col justify-center gap-0.5 rounded-sm text-start outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  onClick={() => {
                    onEdit(item);
                  }}
                >
                  {/* Product name */}
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">{item.product.name}</span>
                    <PencilIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  </span>

                  {/* Quantity and unit price */}
                  <span className="text-xs font-medium text-muted-foreground tabular-nums">
                    {price && 'wholePieceCents' in price ? (
                      <>
                        {t.bill.wholePiece} ·{' '}
                        <Quantity unit={item.unit} amount={itemQuantity(item)} />
                      </>
                    ) : (
                      <>
                        <Quantity unit={item.unit} amount={itemQuantity(item)} />
                        {price && 'perUnitCents' in price && (
                          <>
                            {' × '}
                            <Money cents={price.perUnitCents} />
                          </>
                        )}
                      </>
                    )}
                  </span>

                  {(itemOverrideBy(item) !== null || (belowCost && item.belowCostConfirmed)) && (
                    <span className="flex flex-wrap gap-1">
                      {itemOverrideBy(item) !== null && (
                        <Badge variant="outline" className="border-warning">
                          {t.bill.overrideBy(itemOverrideBy(item) ?? '')}
                        </Badge>
                      )}
                      {belowCost && item.belowCostConfirmed && (
                        <Badge variant="outline" className="border-warning">
                          {t.bill.costConfirmed}
                        </Badge>
                      )}
                    </span>
                  )}

                  {item.lines.length > 1 && (
                    <span className="text-xs text-muted-foreground">
                      {t.splitAcross(item.lines.length)}
                    </span>
                  )}
                </button>

                {/* Total and remove action */}
                <div className="flex min-w-16 flex-col items-end gap-0.5">
                  <span className="whitespace-nowrap text-sm font-bold tabular-nums">
                    <Money cents={totalCents} />
                  </span>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9 text-muted-foreground hover:text-destructive pointer-coarse:size-11"
                    aria-label={`${t.remove}: ${item.product.name}`}
                    onClick={() => {
                      onRemove(item);
                    }}
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
        <dl className="grid gap-1">
          {split && split.discountCents > 0 && (
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <dt className="text-muted-foreground">{t.linesTotal}</dt>
              <dd>
                <Money cents={split.linesTotalCents} />
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
                className="pointer-coarse:h-11"
                disabled={empty}
                onClick={onDiscount}
                aria-label={discount === null ? t.bill.addDiscount : t.bill.editDiscount}
              >
                {discount === null ? t.bill.addDiscount : <Money cents={discount} />}
                <PencilIcon aria-hidden />
              </Button>
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-2 border-t border-dashed border-border pt-2 font-heading text-3xl font-bold tabular-nums">
            <dt className="text-base font-semibold">{t.total}</dt>
            <dd>{total === null ? '—' : <Money cents={total} />}</dd>
          </div>
        </dl>
        {issue && (
          <p role="alert" className="text-sm text-destructive">
            {issue}
          </p>
        )}
        <div className="grid gap-2">
          <Button
            type="button"
            variant="accent"
            size="lg"
            className="h-14 w-full text-lg font-semibold shadow-sm"
            disabled={empty || issue !== undefined || total === null || saving}
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
            disabled={empty || issue !== undefined || total === null || saving}
            className="h-10 w-full pointer-coarse:h-12"
          >
            {t.bill.partialPay}
          </Button>
        </div>
      </footer>
    </section>
  );
}
