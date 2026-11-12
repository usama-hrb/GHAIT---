import {
  goodsBasisOf,
  goodsLineLacksPrice,
  goodsTotalsOf,
  type ZakatGoodsLine,
} from '@fabric/contracts';
import type { ZakatSettings } from '@fabric/core';
import { TriangleAlertIcon } from 'lucide-react';
import { messages } from '@/i18n';
import { Meters, Money, Quantity } from '@/shared/format';
import { Badge } from '@/shared/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { goodsQuantityOf } from './zakat-model';

const t = messages.zakat;

function Left({ line }: { line: ZakatGoodsLine }) {
  const quantity = goodsQuantityOf(line);
  if (quantity.kind === 'length') return <Meters cm={quantity.cm} />;
  if (quantity.kind === 'pieces') return <Quantity unit="piece" amount={quantity.pieces} />;
  return <span className="text-muted-foreground">{t.inventoryStep.awaiting}</span>;
}

/**
 * The inventory valuation audit: every batch held, how much is left, what it cost, the reference
 * price and how the chosen valuation counted it, with the two totals. A batch that the valuation
 * counts at nothing because its product has no price says so beside its figure (Z12). The values
 * are the breakdown's; nothing here values a batch again.
 */
export function GoodsTable({
  goods,
  valuation,
  countedCents,
}: {
  goods: readonly ZakatGoodsLine[];
  valuation: ZakatSettings['goodsValuation'];
  /** What the calculation counted for the goods: the breakdown's total. */
  countedCents: number;
}) {
  if (goods.length === 0) {
    return <p className="text-muted-foreground">{t.inventoryStep.empty}</p>;
  }
  const totals = goodsTotalsOf(goods);
  const columns = t.inventoryStep.columns;
  return (
    <div className="grid gap-3">
      <div className="rounded-lg border bg-card">
        <Table stack>
          <TableHeader>
            <TableRow>
              <TableHead>{columns.batch}</TableHead>
              <TableHead className="text-end">{columns.left}</TableHead>
              <TableHead className="text-end">{columns.cost}</TableHead>
              <TableHead className="text-end">{columns.price}</TableHead>
              <TableHead>{columns.basis}</TableHead>
              <TableHead className="text-end">{columns.value}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {goods.map((line) => {
              const basis = goodsBasisOf(line, valuation);
              return (
                <TableRow key={line.rollId}>
                  <TableCell className="break-words whitespace-normal">{line.label}</TableCell>
                  <TableCell className="text-end" label={columns.left}>
                    <Left line={line} />
                  </TableCell>
                  <TableCell className="text-end" label={columns.cost}>
                    <Money cents={line.costCents} />
                  </TableCell>
                  <TableCell className="text-end" label={columns.price}>
                    {basis === 'length' ? (
                      <>
                        <Money cents={line.refPricePerMeterCents} />/{messages.units.meter}
                      </>
                    ) : (
                      <span aria-hidden>—</span>
                    )}
                  </TableCell>
                  <TableCell label={columns.basis}>
                    <Badge variant="outline" className="h-auto min-h-5 whitespace-normal">
                      {t.inventoryStep.bases[basis]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-end" label={columns.value}>
                    <Money cents={line.valueCents} />
                    {goodsLineLacksPrice(line, valuation) && (
                      <span className="mt-1 flex items-center gap-1 text-xs whitespace-normal text-foreground">
                        <TriangleAlertIcon className="size-3.5 shrink-0 text-warning" aria-hidden />
                        {t.inventoryStep.noPrice}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <dl className="grid gap-1 rounded-lg bg-muted/50 px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">{t.inventoryStep.totals.cost}</dt>
          <dd>
            <Money cents={totals.costCents} />
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 font-semibold">
          <dt>{t.inventoryStep.totals.counted}</dt>
          <dd>
            <Money cents={countedCents} />
          </dd>
        </div>
      </dl>
    </div>
  );
}
