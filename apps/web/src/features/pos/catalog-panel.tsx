'use client';

import { DEFAULT_SELLING_UNITS, type SellingUnits } from '@fabric/contracts';
import { CheckIcon, SearchIcon } from 'lucide-react';
import { useState } from 'react';
import { messages } from '@/i18n';
import type { ProductStockView } from '@/local-db';
import { Meters, Money, Quantity } from '@/shared/format';
import { matchesSearch } from '@/shared/lib/search';
import { ProductPhoto } from '@/shared/brand';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/shared/ui/input-group';

const t = messages.pos.catalog;

/**
 * Whether the till can sell something of this product now (a weight awaiting a length cannot).
 * A unit the shop has switched off (ADR 0023) is not offered, though its stock stays on record.
 */
export const isSellable = (
  product: ProductStockView,
  units: SellingUnits = DEFAULT_SELLING_UNITS,
): boolean =>
  (units.meter && product.availableCm > 0) || (units.piece && product.availablePieces > 0);

/**
 * What can be sold: a search box and a tile per product that has stock left. A tap picks the
 * product; its quantity and price are then entered on the keypad.
 */
export function CatalogPanel({
  products,
  units,
  photos,
  inBill,
  onPick,
}: {
  products: readonly ProductStockView[];
  /** The units the shop sells in now. */
  units: SellingUnits;
  /** Each product's picture (a data: URL), by product id. */
  photos: ReadonlyMap<string, string>;
  /** What of each product is already on the bill, by product id (cm, or pieces). */
  inBill: ReadonlyMap<string, number>;
  onPick: (productId: string) => void;
}) {
  const [search, setSearch] = useState('');

  const tiles = products
    .filter((product) => isSellable(product, units))
    .filter((product) => matchesSearch(search, [product.name, product.sku, ...product.tags]));

  return (
    <section aria-label={messages.pos.title} className="flex min-h-0 flex-1 flex-col gap-3">
      <InputGroup className="h-11 pointer-coarse:h-12">
        <InputGroupAddon>
          <SearchIcon aria-hidden />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          aria-label={t.search}
          placeholder={t.search}
          autoComplete="off"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      </InputGroup>

      {tiles.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">{t.noMatch}</p>
      ) : (
        <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] content-start gap-2.5 overflow-y-auto pb-2 lg:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]">
          {tiles.map((product) => {
            const taken = inBill.get(product.id);
            const meterPrice = product.pricePerMeterCents;
            const piecePrice = product.pricePerPieceCents;
            return (
              <li key={product.id} className="flex">
                <Button
                  type="button"
                  variant="outline"
                  data-selected={taken !== undefined || undefined}
                  className="h-auto min-h-24 w-full touch-manipulation flex-col items-stretch justify-start gap-0 overflow-hidden p-0 text-start whitespace-normal select-none data-selected:border-primary data-selected:ring-2 data-selected:ring-primary/30 pointer-coarse:h-auto"
                  onClick={() => {
                    onPick(product.id);
                  }}
                >
                  <ProductPhoto src={photos.get(product.id)} className="aspect-[4/3] w-full" />
                  <span className="grid w-full gap-1.5 p-2.5">
                    <span className="grid gap-0.5">
                      <span className="line-clamp-2 text-base leading-tight font-semibold">
                        {product.name}
                      </span>
                      {product.sku && (
                        <span className="text-xs font-normal text-muted-foreground">
                          <bdi dir="ltr" data-num>
                            {product.sku}
                          </bdi>
                        </span>
                      )}
                    </span>
                    <span className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm font-normal">
                      <span className="text-base font-semibold">
                        {meterPrice !== null &&
                          units.meter &&
                          product.sellingUnits.includes('meter') && (
                            <>
                              <Money cents={meterPrice} />
                              <span className="text-xs font-normal text-muted-foreground">
                                {' '}
                                / {messages.units.meter}
                              </span>
                            </>
                          )}
                        {piecePrice !== null &&
                          units.piece &&
                          product.sellingUnits.includes('piece') &&
                          product.availablePieces > 0 && (
                            <>
                              <Money cents={piecePrice} />
                              <span className="text-xs font-normal text-muted-foreground">
                                {' '}
                                / {messages.units.piece}
                              </span>
                            </>
                          )}
                      </span>
                      <span className="flex flex-wrap gap-x-2 text-muted-foreground">
                        {product.availableCm > 0 && <Meters cm={product.availableCm} />}
                        {product.availablePieces > 0 && (
                          <Quantity unit="piece" amount={product.availablePieces} />
                        )}
                      </span>
                    </span>
                    {(product.status === 'low' || taken !== undefined) && (
                      <span className="flex flex-wrap gap-1">
                        {product.status === 'low' && (
                          <Badge variant="warning">{messages.inventory.low}</Badge>
                        )}
                        {taken !== undefined && (
                          <Badge variant="secondary">
                            <CheckIcon aria-hidden /> {t.inBill}
                          </Badge>
                        )}
                      </span>
                    )}
                  </span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
