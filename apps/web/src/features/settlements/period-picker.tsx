'use client';

import { useId } from 'react';
import { messages } from '@/i18n';
import { formatDate } from '@/shared/format';
import { Field, FieldDescription, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select';
import { periodLabel } from './period-label';

const t = messages.settlements;

/** The select's value for "another end date": no period end is ever this. */
const OTHER = 'other';

/**
 * Which period the page shows: the months still to settle (the oldest first), the periods already
 * settled, or another end date. The selected period is the one in the trigger; nothing else on
 * the page changes it.
 */
export function PeriodPicker({
  openEnds,
  settled,
  end,
  custom,
  min,
  max,
  onSelect,
  onCustom,
  onDate,
}: {
  /** Month ends that can be settled now, the oldest first. */
  openEnds: readonly string[];
  /** Live settlements, the latest first. */
  settled: readonly { periodStart: string; periodEnd: string }[];
  /** The period end shown ('' for none). */
  end: string;
  /** "Another end date" is chosen: the date field shows. */
  custom: boolean;
  /** The earliest and latest end a period can have now. */
  min: string;
  max: string;
  /** A listed period was picked. */
  onSelect: (end: string) => void;
  /** "Another end date" was picked. */
  onCustom: () => void;
  /** A date was typed in the field of "another end date". */
  onDate: (end: string) => void;
}) {
  const id = useId();
  const listed = openEnds.includes(end) || settled.some((period) => period.periodEnd === end);
  const value = custom || (end !== '' && !listed) ? OTHER : end;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field className="w-full sm:w-60">
        <FieldLabel htmlFor={`${id}-period`} className="text-xs text-muted-foreground">
          {t.period}
        </FieldLabel>
        <Select
          value={value}
          onValueChange={(next) => {
            if (next === OTHER) onCustom();
            else onSelect(next);
          }}
        >
          <SelectTrigger id={`${id}-period`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {openEnds.length > 0 && (
              <SelectGroup>
                <SelectLabel>{t.toSettleGroup}</SelectLabel>
                {openEnds.map((periodEnd) => (
                  <SelectItem key={periodEnd} value={periodEnd}>
                    {formatDate(periodEnd, 'month')}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
            {settled.length > 0 && (
              <SelectGroup>
                <SelectLabel>{t.settledGroup}</SelectLabel>
                {settled.map((period) => (
                  <SelectItem key={period.periodEnd} value={period.periodEnd}>
                    {periodLabel(period.periodStart, period.periodEnd)}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
            <SelectGroup>
              <SelectItem value={OTHER}>{t.otherEnd}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      {value === OTHER && (
        <Field className="w-full sm:w-48">
          <FieldLabel htmlFor={`${id}-end`} className="text-xs text-muted-foreground">
            {t.periodEnd}
          </FieldLabel>
          <Input
            id={`${id}-end`}
            type="date"
            value={end}
            min={min}
            max={max}
            onChange={(event) => {
              onDate(event.target.value);
            }}
          />
          <FieldDescription>{t.periodEndHint}</FieldDescription>
        </Field>
      )}
    </div>
  );
}
