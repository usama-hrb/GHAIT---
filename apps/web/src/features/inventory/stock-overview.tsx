import type { ReactNode } from 'react';
import { messages } from '@/i18n';
import type { ProductStockView } from '@/local-db';
import { Kilograms, Money } from '@/shared/format';
import { AvailableText } from './product-stock-parts';

const t = messages.productStock.detail;

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-0.5 bg-card p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-heading text-lg font-semibold">{children}</dd>
    </div>
  );
}

/**
 * How much there is and what it is worth, in one strip: what can be sold, the cost still held on
 * the batches (only for those who may see costs), how many batches hold it, and the weight still
 * waiting for a length. Selling prices are product details, not stock.
 */
export function StockOverview({
  stock,
  seesCosts,
}: {
  stock: ProductStockView;
  seesCosts: boolean;
}) {
  return (
    <section aria-label={t.stock} className="@container">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border/70 bg-border shadow-sm @xl:grid-cols-[repeat(auto-fit,minmax(0,1fr))] [&>:last-child:nth-child(odd)]:col-span-2 @xl:[&>:last-child:nth-child(odd)]:col-span-1">
        <Figure label={t.available}>
          <AvailableText cm={stock.availableCm} pieces={stock.availablePieces} />
        </Figure>
        {seesCosts && (
          <Figure label={t.stockValue}>
            <Money cents={stock.stockValueCents} />
          </Figure>
        )}
        <Figure label={t.batchCount}>
          <span data-num>{stock.batchCount}</span>
        </Figure>
        {stock.awaitingMeasurementG > 0 && (
          <Figure label={t.awaiting}>
            <Kilograms grams={stock.awaitingMeasurementG} />
          </Figure>
        )}
      </dl>
    </section>
  );
}
