'use client';

import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useMemo, useState } from 'react';
import { messages } from '@/i18n';
import type { ProductMovementView } from '@/local-db';
import { DateText, Kilograms, Meters, Money } from '@/shared/format';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import {
  batchesOfMovements,
  countByType,
  filterMovements,
  isFiltering,
  type MovementFilter,
  NO_FILTER,
  typesOfMovements,
} from './movement-filter';
import { MovementFilterBar } from './movement-filter-bar';

const t = messages.productStock.detail;

/** The history opens on this many movements; the rest is one tap away. */
const RECENT = 10;

// Written out in full so that Tailwind finds the classes.
const WITH_COSTS =
  '@2xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(0,0.8fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)]';
const WITHOUT_COSTS =
  '@2xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(0,0.8fr)_minmax(0,1.3fr)_minmax(0,1fr)]';

/** A movement's size in its own unit, without its sign. */
function Size({ move }: { move: ProductMovementView }) {
  const size = Math.abs(move.amount);
  switch (move.unit) {
    case 'meter':
      return <Meters cm={size} />;
    case 'kg':
      return <Kilograms grams={size} />;
    case 'piece':
      return <span data-num>{messages.productStock.piecesCount(size)}</span>;
  }
}

/**
 * What the movement did to the stock: an arrow, a sign and the size, so that in and out read
 * without colour. A measurement sets the length of a batch rather than changing it: no sign.
 */
function Change({ move }: { move: ProductMovementView }) {
  if (move.type === 'measurement') {
    return <Size move={move} />;
  }
  const into = move.amount > 0;
  const Arrow = into ? ArrowDownIcon : ArrowUpIcon;
  return (
    <span className={cn('inline-flex items-center gap-1 font-medium', into && 'text-success')}>
      <Arrow className="size-3.5" aria-hidden />
      <span className="sr-only">{into ? t.stockIn : t.stockOut}</span>
      <bdi dir="ltr" data-num>
        <span aria-hidden>{into ? '+' : '−'}</span>
        <Size move={move} />
      </bdi>
    </span>
  );
}

function Source({
  move,
  supplier,
  seesCosts,
}: {
  move: ProductMovementView;
  supplier: string | undefined;
  seesCosts: boolean;
}) {
  const reference = move.reference;
  let link: ReactNode = null;
  if (reference?.kind === 'purchase') {
    const label = supplier ? `${t.moveTypes.purchase} · ${supplier}` : t.moveTypes.purchase;
    // A purchase shows its cost: for those who may see costs only.
    link = seesCosts ? (
      <Link href={`/purchases/view?id=${reference.id}`} className="underline underline-offset-4">
        {label}
      </Link>
    ) : (
      label
    );
  } else if (reference?.kind === 'sale') {
    link = (
      <Link href={`/pos/view?id=${reference.id}`} className="underline underline-offset-4">
        {t.moveTypes.sale}
      </Link>
    );
  }
  if (link === null && move.note === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="grid min-w-0 gap-0.5">
      {link && <span className="truncate">{link}</span>}
      {move.note && (
        <span className="truncate text-muted-foreground" title={move.note}>
          {move.note}
        </span>
      )}
    </span>
  );
}

/**
 * Every movement of the product, newest first: what happened, when, how much, on which batch and
 * where it came from (the purchase, the sale, or the reason the owner wrote). The latest few show
 * first; the whole history is one tap away. It can be narrowed by type, batch and days.
 */
export function MovementHistory({
  movements,
  supplierOfPurchase,
  seesCosts,
}: {
  movements: readonly ProductMovementView[];
  supplierOfPurchase: Readonly<Record<string, string>>;
  seesCosts: boolean;
}) {
  const [all, setAll] = useState(false);
  const [filter, setFilter] = useState<MovementFilter>(NO_FILTER);
  const matching = useMemo(() => filterMovements(movements, filter), [movements, filter]);
  const types = useMemo(() => typesOfMovements(movements), [movements]);
  const batches = useMemo(() => batchesOfMovements(movements), [movements]);
  const counts = useMemo(() => countByType(movements, filter), [movements, filter]);
  const shown = all ? matching : matching.slice(0, RECENT);
  // A new filter starts from the latest few again: a list made short by it must not leave the
  // history stuck open once the filter is cleared.
  const change = (next: MovementFilter) => {
    setFilter(next);
    setAll(false);
  };
  const columns = seesCosts ? WITH_COSTS : WITHOUT_COSTS;

  return (
    <section aria-labelledby="product-history" className="grid gap-2">
      <h3 id="product-history" className="font-heading font-semibold">
        {t.history}
      </h3>
      {movements.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          {t.noHistory}
        </p>
      ) : (
        <div className="@container overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
          {movements.length > 1 && (
            <MovementFilterBar
              filter={filter}
              onChange={change}
              types={types}
              counts={counts}
              batches={batches}
              shown={matching.length}
              total={movements.length}
            />
          )}
          <div
            aria-hidden
            className={cn(
              'hidden gap-x-4 border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground @2xl:grid',
              columns,
            )}
          >
            <span>{t.history}</span>
            <span>{t.when}</span>
            <span>{t.batch}</span>
            <span>{t.source}</span>
            <span className="text-end">{t.change}</span>
            {seesCosts && <span className="text-end">{t.cost}</span>}
          </div>
          {matching.length === 0 && (
            <div className="grid justify-items-center gap-1 px-4 py-6 text-center text-sm text-muted-foreground">
              <p>{t.filters.noMatch}</p>
              {isFiltering(filter) && (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => {
                    change(NO_FILTER);
                  }}
                >
                  {t.filters.clear}
                </Button>
              )}
            </div>
          )}
          <ul className="divide-y">
            {shown.map((move) => (
              <li
                key={move.id}
                className={cn(
                  'grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 px-3 py-2.5 @2xl:items-center',
                  columns,
                )}
              >
                <span className="font-medium">{t.moveTypes[move.type]}</span>
                <div className="col-start-1 row-start-2 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground @2xl:contents">
                  <DateText
                    value={move.createdAt}
                    format="dateTime"
                    className="@2xl:text-sm @2xl:text-foreground"
                  />
                  <bdi dir="ltr" data-num className="@2xl:text-sm @2xl:text-foreground">
                    {move.code}
                  </bdi>
                  <span className="min-w-0 @2xl:text-sm">
                    <Source
                      move={move}
                      supplier={move.reference ? supplierOfPurchase[move.reference.id] : undefined}
                      seesCosts={seesCosts}
                    />
                  </span>
                </div>
                <span className="col-start-2 row-start-1 justify-self-end text-sm @2xl:col-auto @2xl:row-auto">
                  <Change move={move} />
                </span>
                {seesCosts && (
                  <span className="col-start-2 row-start-2 justify-self-end text-xs text-muted-foreground @2xl:col-auto @2xl:row-auto @2xl:text-sm">
                    {move.costCents === null ? '' : <Money cents={move.costCents} />}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {matching.length > RECENT && (
            <div className="border-t p-2 text-center">
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={all}
                onClick={() => {
                  setAll((current) => !current);
                }}
              >
                {all ? t.showRecent : `${t.showAll} (${String(matching.length)})`}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
