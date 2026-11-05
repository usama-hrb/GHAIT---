'use client';

import { EllipsisIcon, RulerIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { messages } from '@/i18n';
import type { ProductBatchView, ProductStockView } from '@/local-db';
import { DateText, Kilograms, Meters, Money } from '@/shared/format';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { AvailableText, BatchStatusBadge, Holding } from './product-stock-parts';
import { ReviewBadge } from './stock-badges';

const t = messages.productStock;

export type BatchAction = 'measure' | 'loss' | 'count';

// Written out in full so that Tailwind finds the classes.
const WITH_COSTS =
  '@2xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_8.5rem]';
const WITHOUT_COSTS = '@2xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_8.5rem]';

/** A figure of a row: its column header shows on a wide list, its own label on a narrow one. */
function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 content-start gap-0.5 text-sm @2xl:justify-items-end @2xl:text-end">
      <span className="text-xs text-muted-foreground @2xl:sr-only">{label}</span>
      {children}
    </div>
  );
}

/** What a batch was received as: the weight for a batch bought by the kilo, else its length or count. */
function Received({ batch }: { batch: ProductBatchView }) {
  if (batch.receivedG !== null) {
    // A weight still waiting for its length is shown as what it holds; nothing to add.
    return batch.status === 'pending' ? null : <Kilograms grams={batch.receivedG} />;
  }
  return batch.unit === 'piece' ? (
    <AvailableText cm={0} pieces={batch.receivedQuantity} />
  ) : (
    <Meters cm={batch.receivedQuantity} />
  );
}

/** What one unit of the batch cost when bought; a weight without a length has none yet. */
function UnitCost({ batch }: { batch: ProductBatchView }) {
  if (batch.costPerMeterCents !== null) {
    return (
      <span>
        <Money cents={batch.costPerMeterCents} />{' '}
        <span className="text-xs text-muted-foreground">{t.perUnit.meter}</span>
      </span>
    );
  }
  if (batch.costPerPieceCents !== null) {
    return (
      <span>
        <Money cents={batch.costPerPieceCents} />{' '}
        <span className="text-xs text-muted-foreground">{t.perUnit.piece}</span>
      </span>
    );
  }
  return <span className="text-muted-foreground">{t.status.awaiting}</span>;
}

function BatchActions({
  batch,
  onAction,
  onRemnant,
}: {
  batch: ProductBatchView;
  onAction: (action: BatchAction, batchId: string) => void;
  onRemnant: (batchId: string, remnant: boolean) => void;
}) {
  const needsLength = batch.status === 'estimated' || batch.status === 'pending';
  return (
    <div className="col-start-3 row-start-1 flex flex-wrap items-start justify-end gap-1 @2xl:col-auto @2xl:row-auto @2xl:flex-nowrap @2xl:items-center">
      {needsLength && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onAction('measure', batch.batchId);
          }}
        >
          <RulerIcon data-icon="inline-start" aria-hidden />
          {t.detail.measure}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`${t.actions.batchActions}: ${batch.code}`}
          >
            <EllipsisIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!needsLength && batch.unit !== 'piece' && (
            <DropdownMenuItem
              onSelect={() => {
                onAction('measure', batch.batchId);
              }}
            >
              {t.actions.measure}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() => {
              onAction('loss', batch.batchId);
            }}
          >
            {t.actions.loss}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              onAction('count', batch.batchId);
            }}
          >
            {t.actions.count}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              onRemnant(batch.batchId, !batch.remnant);
            }}
          >
            {batch.remnant ? t.actions.unmarkRemnant : t.actions.markRemnant}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * The batches that make up the stock, oldest first (the order a sale takes them). Each keeps what
 * its own purchase cost, so two batches of one product can sit side by side at different costs.
 * A table on a wide page, a stack of labelled figures on a narrow one.
 */
export function BatchList({
  stock,
  supplierOfPurchase,
  seesCosts,
  canAct,
  onAction,
  onRemnant,
}: {
  stock: ProductStockView;
  supplierOfPurchase: Readonly<Record<string, string>>;
  seesCosts: boolean;
  /** The owner changes stock; a partner reads it. */
  canAct: boolean;
  onAction: (action: BatchAction, batchId: string) => void;
  onRemnant: (batchId: string, remnant: boolean) => void;
}) {
  const columns = seesCosts ? WITH_COSTS : WITHOUT_COSTS;
  return (
    <section aria-labelledby="product-batches" className="grid gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 id="product-batches" className="font-heading font-semibold">
          {t.detail.batches}
        </h3>
        <span className="text-sm text-muted-foreground">{t.detail.batchesHint}</span>
      </div>
      {stock.batches.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          {t.detail.noBatches}
        </p>
      ) : (
        <div className="@container overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
          <div
            aria-hidden
            className={cn(
              'hidden gap-x-4 border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground @2xl:grid',
              columns,
            )}
          >
            <span>{t.detail.batch}</span>
            <span className="text-end">{t.detail.remaining}</span>
            {seesCosts && (
              <>
                <span className="text-end">{t.detail.unitCost}</span>
                <span className="text-end">{t.detail.remainingValue}</span>
              </>
            )}
            <span />
          </div>
          <ul className="divide-y">
            {stock.batches.map((batch) => {
              const supplier = supplierOfPurchase[batch.purchaseId];
              return (
                <li
                  key={batch.batchId}
                  className={cn(
                    'grid grid-cols-3 gap-x-4 gap-y-3 px-3 py-3 @2xl:items-center',
                    columns,
                  )}
                >
                  <div className="col-span-2 grid min-w-0 gap-1 @2xl:col-span-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <bdi dir="ltr" data-num className="font-medium">
                        {batch.code}
                      </bdi>
                      <BatchStatusBadge status={batch.status} />
                      {batch.remnant && <Badge variant="warning">{t.detail.remnant}</Badge>}
                      {batch.oversold && <ReviewBadge />}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      <DateText value={batch.purchaseDate} />
                      {supplier && (
                        <>
                          {' · '}
                          <span className="text-foreground">{supplier}</span>
                        </>
                      )}
                      {seesCosts && (
                        <>
                          {' · '}
                          <Link
                            href={`/purchases/view?id=${batch.purchaseId}`}
                            className="underline underline-offset-4"
                          >
                            {t.detail.purchase}
                          </Link>
                        </>
                      )}
                    </span>
                  </div>
                  <Cell label={t.detail.remaining}>
                    <span className="font-medium">
                      <Holding batch={batch} />
                    </span>
                    {batch.status !== 'pending' && (
                      <span className="text-xs text-muted-foreground">
                        {t.detail.received} <Received batch={batch} />
                      </span>
                    )}
                  </Cell>
                  {seesCosts && (
                    <>
                      <Cell label={t.detail.unitCost}>
                        <UnitCost batch={batch} />
                        <span className="text-xs text-muted-foreground">
                          {t.detail.purchaseCost} <Money cents={batch.costTotalCents} />
                        </span>
                      </Cell>
                      <Cell label={t.detail.remainingValue}>
                        <span className="font-medium">
                          <Money cents={batch.remainingCostCents} />
                        </span>
                      </Cell>
                    </>
                  )}
                  {canAct ? (
                    <BatchActions batch={batch} onAction={onAction} onRemnant={onRemnant} />
                  ) : (
                    <span className="hidden @2xl:block" />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
