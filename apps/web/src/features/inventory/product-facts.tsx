import type { Product } from '@fabric/contracts';
import { messages } from '@/i18n';
import type { Local, ProductStockView } from '@/local-db';
import { Kilograms, Meters, Money } from '@/shared/format';
import { Badge } from '@/shared/ui/badge';
import { AvailableText, Fact, unitNames } from './product-stock-parts';

const t = messages.productStock;

/**
 * What the product is, once: how it is bought and sold, the weight to length it usually makes,
 * when it counts as low, what it sells for, and the description. Nothing here repeats the header
 * or the stock figures.
 */
export function ProductFacts({
  record,
  stock,
}: {
  record: Local<Product>;
  stock: ProductStockView;
}) {
  const conversion = record.kgToMeterConversion;
  const sellingUnits = record.sellingUnits;
  return (
    <section aria-labelledby="product-details" className="grid gap-2">
      <h3 id="product-details" className="font-heading font-semibold">
        {t.detail.details}
      </h3>
      <dl className="grid gap-x-6 gap-y-3 rounded-xl border border-border/70 bg-card p-3 text-sm shadow-sm sm:grid-cols-2">
        <Fact label={t.detail.boughtIn}>
          {record.purchaseUnits.length > 0 ? unitNames(record.purchaseUnits) : '—'}
        </Fact>
        <Fact label={t.detail.soldIn}>{unitNames(sellingUnits)}</Fact>
        <Fact label={t.detail.conversion}>
          {conversion ? (
            <>
              <Kilograms grams={conversion.weightG} /> = <Meters cm={conversion.lengthCm} />{' '}
              <span className="font-normal text-muted-foreground">
                ({t.detail.conversionSource[conversion.source]})
              </span>
            </>
          ) : (
            <span className="font-normal text-muted-foreground">{t.detail.noConversion}</span>
          )}
        </Fact>
        <Fact label={t.detail.lowStock}>
          {stock.lowStockThreshold === null ? (
            <span className="font-normal text-muted-foreground">{t.detail.noLowStock}</span>
          ) : stock.lowStockUnit === 'piece' ? (
            <AvailableText cm={0} pieces={stock.lowStockThreshold} />
          ) : (
            <Meters cm={stock.lowStockThreshold} />
          )}
        </Fact>
        {sellingUnits.map((unit) => {
          const normal = unit === 'meter' ? record.pricePerMeterCents : record.pricePerPieceCents;
          const min =
            unit === 'meter' ? record.minPricePerMeterCents : record.minPricePerPieceCents;
          return (
            <Fact key={unit} label={`${t.detail.prices} · ${t.perUnit[unit]}`}>
              {normal == null ? (
                '—'
              ) : (
                <>
                  <Money cents={normal} />
                  <span className="block text-xs font-normal text-muted-foreground">
                    {t.detail.minPrice}: {min == null ? '—' : <Money cents={min} />}
                  </span>
                </>
              )}
            </Fact>
          );
        })}
        {record.description && (
          <Fact label={t.detail.description} className="sm:col-span-2">
            {record.description}
          </Fact>
        )}
        {record.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 sm:col-span-2">
            {record.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </dl>
    </section>
  );
}
