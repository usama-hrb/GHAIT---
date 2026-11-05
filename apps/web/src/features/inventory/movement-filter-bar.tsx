'use client';

import { CheckIcon, XIcon } from 'lucide-react';
import { useId } from 'react';
import { messages } from '@/i18n';
import { Button } from '@/shared/ui/button';
import { Field, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { isFiltering, type MovementFilter, type MovementType, NO_FILTER } from './movement-filter';

const t = messages.productStock.detail;

/** Radix Select has no empty value: this stands for "every batch". */
const EVERY_BATCH = 'all';

/**
 * The controls over the movement history: the types to show (toggle chips with the number each
 * would show), the batch, and the days from and to. The bar only offers what the history has: no
 * chip for a type it never had, no batch choice for a single batch.
 */
export function MovementFilterBar({
  filter,
  onChange,
  types,
  counts,
  batches,
  shown,
  total,
}: {
  filter: MovementFilter;
  onChange: (next: MovementFilter) => void;
  /** The types the history has, in the order to offer them. */
  types: readonly MovementType[];
  /** How many movements each type would show with the rest of the filter. */
  counts: ReadonlyMap<MovementType, number>;
  batches: readonly { batchId: string; code: string }[];
  shown: number;
  total: number;
}) {
  const id = useId();
  const filtering = isFiltering(filter);

  const toggle = (type: MovementType) => {
    const on = filter.types.includes(type);
    onChange({
      ...filter,
      types: on ? filter.types.filter((chosen) => chosen !== type) : [...filter.types, type],
    });
  };

  return (
    <div
      role="group"
      aria-label={t.filters.label}
      className="grid gap-2.5 border-b bg-muted/20 px-3 py-2.5"
    >
      {types.length > 1 && (
        <div role="group" aria-label={t.filters.types} className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={filter.types.length === 0 ? 'secondary' : 'outline'}
            aria-pressed={filter.types.length === 0}
            onClick={() => {
              onChange({ ...filter, types: [] });
            }}
          >
            {filter.types.length === 0 && <CheckIcon data-icon="inline-start" aria-hidden />}
            {t.filters.all}
          </Button>
          {types.map((type) => {
            const on = filter.types.includes(type);
            const count = counts.get(type) ?? 0;
            return (
              <Button
                key={type}
                type="button"
                size="sm"
                variant={on ? 'secondary' : 'outline'}
                aria-pressed={on}
                // A type with nothing to show under the rest of the filter can still be unchosen.
                disabled={count === 0 && !on}
                onClick={() => {
                  toggle(type);
                }}
              >
                {on && <CheckIcon data-icon="inline-start" aria-hidden />}
                {t.moveTypes[type]}
                <span data-num className="text-muted-foreground">
                  {count}
                </span>
              </Button>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        {batches.length > 1 && (
          <Field className="w-36">
            <FieldLabel htmlFor={`${id}-batch`} className="text-xs text-muted-foreground">
              {t.filters.batch}
            </FieldLabel>
            <Select
              value={filter.batchId ?? EVERY_BATCH}
              onValueChange={(next) => {
                onChange({ ...filter, batchId: next === EVERY_BATCH ? null : next });
              }}
            >
              <SelectTrigger id={`${id}-batch`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={EVERY_BATCH}>{t.filters.allBatches}</SelectItem>
                {batches.map((batch) => (
                  <SelectItem key={batch.batchId} value={batch.batchId}>
                    <bdi dir="ltr" data-num>
                      {batch.code}
                    </bdi>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <Field className="w-36">
          <FieldLabel htmlFor={`${id}-from`} className="text-xs text-muted-foreground">
            {t.filters.from}
          </FieldLabel>
          <Input
            id={`${id}-from`}
            type="date"
            value={filter.from}
            max={filter.to === '' ? undefined : filter.to}
            onChange={(event) => {
              onChange({ ...filter, from: event.target.value });
            }}
          />
        </Field>
        <Field className="w-36">
          <FieldLabel htmlFor={`${id}-to`} className="text-xs text-muted-foreground">
            {t.filters.to}
          </FieldLabel>
          <Input
            id={`${id}-to`}
            type="date"
            value={filter.to}
            min={filter.from === '' ? undefined : filter.from}
            onChange={(event) => {
              onChange({ ...filter, to: event.target.value });
            }}
          />
        </Field>
        {filtering && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              onChange(NO_FILTER);
            }}
          >
            <XIcon data-icon="inline-start" aria-hidden />
            {t.filters.clear}
          </Button>
        )}
        {/* Always in the page, so that a screen reader hears the count change. */}
        <p role="status" className="ms-auto self-center text-xs text-muted-foreground">
          {filtering ? t.filters.showing(shown, total) : null}
        </p>
      </div>
    </div>
  );
}
