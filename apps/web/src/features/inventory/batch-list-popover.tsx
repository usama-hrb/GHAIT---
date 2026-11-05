'use client';

import { ChevronDownIcon } from 'lucide-react';
import Link from 'next/link';
import { messages } from '@/i18n';
import type { ProductStockView } from '@/local-db';
import { DateText, Money } from '@/shared/format';
import { Button } from '@/shared/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import { Holding } from './product-stock-parts';

const t = messages.productStock;

/**
 * The batches that still hold stock, each with what it was bought for: the stock figures of the
 * list are an average, so this is where every batch's own purchase cost can be read. Costs only
 * for those who may see them.
 */
export function BatchListPopover({
  product,
  seesCosts,
}: {
  product: ProductStockView;
  seesCosts: boolean;
}) {
  // Batches with stock come first (the order a sale takes them); batchCount counts those.
  const held = product.batches.slice(0, product.batchCount);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={held.length === 0}
          aria-label={`${t.columns.batches}: ${String(product.batchCount)} - ${product.name}`}
          className="relative z-10 touch-manipulation tabular-nums pointer-coarse:h-11"
        >
          <span data-num>{product.batchCount}</span>
          <ChevronDownIcon data-icon="inline-end" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-0 p-0">
        <p className="border-b border-dashed border-border px-3 py-2 text-sm font-semibold">
          {t.batchList.title}
        </p>
        <ul className="max-h-72 divide-y divide-dashed divide-border overflow-y-auto">
          {held.map((batch) => {
            const perUnit =
              batch.costPerMeterCents !== null
                ? { cents: batch.costPerMeterCents, unit: t.perUnit.meter }
                : batch.costPerPieceCents !== null
                  ? { cents: batch.costPerPieceCents, unit: t.perUnit.piece }
                  : null;
            return (
              <li key={batch.batchId} className="grid gap-1 px-3 py-2 text-sm">
                <span className="flex items-center justify-between gap-2">
                  <bdi dir="ltr" data-num className="font-medium">
                    {batch.code}
                  </bdi>
                  <span className="text-xs text-muted-foreground">
                    <DateText value={batch.purchaseDate} />
                  </span>
                </span>
                <span className="flex items-center justify-between gap-2 text-muted-foreground">
                  {t.batchList.left}
                  <span className="text-foreground">
                    <Holding batch={batch} />
                  </span>
                </span>
                {seesCosts && (
                  <>
                    <span className="flex items-center justify-between gap-2 text-muted-foreground">
                      {t.batchList.boughtFor}
                      <span className="text-foreground">
                        <Money cents={batch.costTotalCents} />
                        {perUnit && (
                          <span className="text-muted-foreground">
                            {' · '}
                            <Money cents={perUnit.cents} /> {perUnit.unit}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-2 text-muted-foreground">
                      {t.batchList.valueLeft}
                      <span className="text-foreground">
                        <Money cents={batch.remainingCostCents} />
                      </span>
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
        <div className="border-t border-dashed border-border p-1.5">
          <Button asChild variant="ghost" size="sm" className="w-full justify-center">
            <Link href={`/inventory/product?id=${product.id}`}>{t.actions.open}</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
