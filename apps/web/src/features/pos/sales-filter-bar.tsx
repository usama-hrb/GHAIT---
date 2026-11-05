'use client';

import { CheckIcon, RotateCcwIcon, SearchIcon, XIcon } from 'lucide-react';
import { useId } from 'react';
import { messages } from '@/i18n';
import { formatDate } from '@/shared/format';
import { Button } from '@/shared/ui/button';
import { Field, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import {
  activeFilters,
  DEFAULT_FILTER,
  type HistoryFilter,
  PAYMENT_FILTERS,
  type PaymentFilter,
  PERIOD_PRESETS,
  type PeriodPreset,
} from './sales-history';

const h = messages.sales.history;

/** The words for a period: the preset's name, or the days of a custom one. */
export function periodLabel(filter: HistoryFilter): string {
  if (filter.period !== 'custom') return h.period[filter.period];
  const day = (value: string) => (value === '' ? h.filters.openEnd : formatDate(value, 'medium'));
  return h.filters.customRange(day(filter.from), day(filter.to));
}

/** The period: a preset, or two days (the header's date range selection). */
export function PeriodControl({
  filter,
  onChange,
}: {
  filter: HistoryFilter;
  onChange: (next: HistoryFilter) => void;
}) {
  const id = useId();
  return (
    <div role="group" aria-label={h.period.label} className="flex flex-wrap items-end gap-2">
      <Field className="w-44">
        <FieldLabel htmlFor={`${id}-period`} className="text-xs text-muted-foreground">
          {h.period.label}
        </FieldLabel>
        <Select
          value={filter.period}
          onValueChange={(next) => {
            onChange({ ...filter, period: next as PeriodPreset });
          }}
        >
          <SelectTrigger id={`${id}-period`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_PRESETS.map((preset) => (
              <SelectItem key={preset} value={preset}>
                {h.period[preset]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {filter.period === 'custom' && (
        <>
          <Field className="w-40">
            <FieldLabel htmlFor={`${id}-from`} className="text-xs text-muted-foreground">
              {h.period.from}
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
          <Field className="w-40">
            <FieldLabel htmlFor={`${id}-to`} className="text-xs text-muted-foreground">
              {h.period.to}
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
        </>
      )}
    </div>
  );
}

/**
 * The search and the payment chips (each with the number of sales it would show), and, when the
 * list is narrowed beyond the default view, the filters in force, each removable, with a reset.
 */
export function SalesFilterBar({
  filter,
  onChange,
  counts,
}: {
  filter: HistoryFilter;
  onChange: (next: HistoryFilter) => void;
  counts: Readonly<Record<PaymentFilter, number>>;
}) {
  const id = useId();
  const active = activeFilters(filter);
  return (
    <div role="group" aria-label={h.filters.label} className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <SearchIcon
            className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id={`${id}-search`}
            type="search"
            className="ps-8 pe-11 [&::-webkit-search-cancel-button]:appearance-none"
            aria-label={h.filters.search}
            placeholder={h.filters.searchPlaceholder}
            value={filter.search}
            onChange={(event) => {
              onChange({ ...filter, search: event.target.value });
            }}
          />
          {filter.search !== '' && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute end-0.5 top-1/2 -translate-y-1/2"
              aria-label={h.filters.clearSearch}
              onClick={() => {
                onChange({ ...filter, search: '' });
              }}
            >
              <XIcon aria-hidden />
            </Button>
          )}
        </div>
        <div role="group" aria-label={h.filters.payment} className="flex flex-wrap gap-1.5">
          {PAYMENT_FILTERS.map((payment) => {
            const on = filter.payment === payment;
            return (
              <Button
                key={payment}
                type="button"
                variant={on ? 'secondary' : 'outline'}
                aria-pressed={on}
                onClick={() => {
                  onChange({ ...filter, payment });
                }}
              >
                {on && <CheckIcon data-icon="inline-start" aria-hidden />}
                {h.filters[payment]}
                <span data-num className="text-muted-foreground">
                  {counts[payment]}
                </span>
              </Button>
            );
          })}
        </div>
      </div>
      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm text-muted-foreground">{h.filters.active}</span>
          {active.map((kind) => {
            const label =
              kind === 'period'
                ? periodLabel(filter)
                : kind === 'search'
                  ? h.filters.searchChip(filter.search.trim())
                  : h.filters[filter.payment];
            return (
              <Button
                key={kind}
                type="button"
                size="sm"
                variant="secondary"
                aria-label={h.filters.remove(label)}
                onClick={() => {
                  onChange({
                    ...filter,
                    ...(kind === 'period'
                      ? { period: DEFAULT_FILTER.period, from: '', to: '' }
                      : kind === 'search'
                        ? { search: '' }
                        : { payment: 'all' as const }),
                  });
                }}
              >
                {label}
                <XIcon data-icon="inline-end" aria-hidden />
              </Button>
            );
          })}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              onChange(DEFAULT_FILTER);
            }}
          >
            <RotateCcwIcon data-icon="inline-start" aria-hidden />
            {h.filters.reset}
          </Button>
        </div>
      )}
    </div>
  );
}
