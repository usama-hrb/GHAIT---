'use client';

import { CheckIcon, SearchIcon } from 'lucide-react';
import { useState } from 'react';
import { messages } from '@/i18n';
import type { FabricStock } from '@/local-db';
import { Meters, Money } from '@/shared/format';
import { matchesSearch } from '@/shared/lib/search';
import { ProductPhoto } from '@/shared/brand';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/shared/ui/input-group';

const t = messages.pos.catalog;

/**
 * What can be sold: a search box, a chip per fabric, and a tile per colour that has cloth left.
 * A tap picks the colour; its length and price are then entered on the keypad.
 */
export function CatalogPanel({
  fabrics,
  photos,
  inBill,
  onPick,
}: {
  fabrics: readonly FabricStock[];
  /** Each colour's picture (a data: URL), by variant id. */
  photos: ReadonlyMap<string, string>;
  /** cm of each colour already on the bill, by variant id. */
  inBill: ReadonlyMap<string, number>;
  onPick: (fabricId: string, variantId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [fabricId, setFabricId] = useState<string | null>(null);

  const selling = fabrics.filter((entry) => entry.colors.some((color) => color.remainingCm > 0));
  const tiles = selling
    .filter((entry) => fabricId === null || entry.fabric.id === fabricId)
    .flatMap((entry) =>
      entry.colors
        .filter((color) => color.remainingCm > 0)
        .filter((color) =>
          matchesSearch(search, [entry.fabric.name, color.variant.colorName, ...entry.fabric.tags]),
        )
        .map((color) => ({ entry, color })),
    );

  return (
    <section aria-label={messages.pos.title} className="flex min-h-0 flex-1 flex-col gap-3">
      <InputGroup>
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

      <div role="group" aria-label={t.fabrics} className="flex gap-2 overflow-x-auto pb-1">
        {' '}
        {[{ id: null, name: t.all }, ...selling.map((entry) => entry.fabric)].map((chip) => (
          <Button
            key={chip.id ?? 'all'}
            type="button"
            size="sm"
            variant={fabricId === chip.id ? 'default' : 'outline'}
            aria-pressed={fabricId === chip.id}
            className="shrink-0 touch-manipulation pointer-coarse:h-11"
            onClick={() => {
              setFabricId(chip.id);
            }}
          >
            {chip.name}
          </Button>
        ))}
      </div>

      {tiles.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">{t.noMatch}</p>
      ) : (
        <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] content-start gap-3 overflow-y-auto pb-2">
          {tiles.map(({ entry, color }) => {
            const taken = inBill.get(color.variant.id);
            return (
              <li key={color.variant.id} className="flex">
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto min-h-28 w-full touch-manipulation flex-col items-stretch justify-start gap-0 overflow-hidden p-0 text-start whitespace-normal select-none pointer-coarse:h-auto"
                  onClick={() => {
                    onPick(entry.fabric.id, color.variant.id);
                  }}
                >
                  <ProductPhoto
                    src={photos.get(color.variant.id)}
                    className="aspect-[3/3] w-full"
                  />
                  <span className="grid w-full gap-2 p-3">
                    <span className="grid gap-0.5">
                      <span className="text-lg leading-tight font-semibold">
                        {color.variant.colorName}
                      </span>
                      <span className="text-sm font-normal text-muted-foreground">
                        {entry.fabric.name}
                      </span>
                    </span>
                    <span className="grid gap-1 text-sm font-normal">
                      <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                        <Meters cm={color.remainingCm} />
                        <span className="text-muted-foreground">
                          <Money cents={entry.fabric.refPricePerMeterCents} /> /{' '}
                          {messages.units.meter}
                        </span>
                      </span>
                      {(color.state === 'low' || taken !== undefined) && (
                        <span className="flex flex-wrap gap-1">
                          {color.state === 'low' && (
                            <Badge variant="warning">{messages.inventory.low}</Badge>
                          )}
                          {taken !== undefined && (
                            <Badge variant="secondary">
                              <CheckIcon aria-hidden /> {t.inBill} · <Meters cm={taken} />
                            </Badge>
                          )}
                        </span>
                      )}
                    </span>
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
