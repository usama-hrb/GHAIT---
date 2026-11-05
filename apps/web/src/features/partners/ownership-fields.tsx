'use client';

import { CircleAlertIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { messages } from '@/i18n';
import { cn } from '@/shared/lib/utils';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { sharesTotal } from './people-view';

const t = messages.partners.ownershipFields;

/** One participant of the ownership table and the percentage typed for them. */
export interface OwnershipRow {
  key: string;
  label: ReactNode;
  value: string;
}

/**
 * Who owns what part of the shop (S4): a percentage for each person, and the total under them.
 * The table is saved whole, so the total has to be exactly 100%; it says so in words, not only
 * in colour. Used by the ownership dialog and by adding a partner, who joins the table at 0%.
 */
export function OwnershipFields({
  rows,
  idPrefix,
  showErrors,
  onChange,
}: {
  rows: readonly OwnershipRow[];
  idPrefix: string;
  /** The form was submitted: a share that is not a number is marked. */
  showErrors: boolean;
  onChange: (key: string, value: string) => void;
}) {
  const { bps, totalBp, exact } = sharesTotal(rows.map((row) => row.value));
  return (
    <div className="grid gap-2">
      <ul className="grid gap-2">
        {rows.map((row, index) => {
          const invalid = showErrors && bps[index] === null;
          return (
            <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-3">
              <Label htmlFor={`${idPrefix}-${row.key}`} className="min-w-0 break-words">
                {row.label}
              </Label>
              <div className="flex items-center gap-1.5">
                <Input
                  id={`${idPrefix}-${row.key}`}
                  inputMode="decimal"
                  dir="ltr"
                  className="text-end"
                  aria-invalid={invalid || undefined}
                  value={row.value}
                  onChange={(event) => {
                    onChange(row.key, event.target.value);
                  }}
                />
                <span aria-hidden className="text-muted-foreground">
                  %
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <div
        aria-live="polite"
        className={cn(
          'flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm',
          exact ? 'bg-muted' : 'bg-destructive/10 text-destructive',
        )}
      >
        <span className="flex items-center gap-1.5 font-medium">
          {!exact && <CircleAlertIcon className="size-4" aria-hidden />}
          {t.total}
        </span>
        <span data-num>
          <bdi>{totalBp / 100}%</bdi>
        </span>
        {!exact && <span className="basis-full">{t.mustBe100}</span>}
      </div>
    </div>
  );
}
