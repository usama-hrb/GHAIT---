'use client';

import type { MoneyUnit } from '@fabric/core';
import { messages } from '@/i18n';
import { cn } from '@/shared/lib/utils';
import { useMoneyUnit } from './money-unit';

const OPTIONS: { unit: MoneyUnit; label: string }[] = [
  { unit: 'rial', label: messages.units.rial },
  { unit: 'dirham', label: messages.units.dirhamFull },
];

/** Quick rial ⇄ dirham switch for every amount on screen (SPEC §0.2). */
export function MoneyUnitToggle({ className }: { className?: string }) {
  const { unit, setUnit } = useMoneyUnit();
  return (
    <div
      role="radiogroup"
      aria-label={messages.money.unitLabel}
      className={cn('inline-flex rounded-lg border border-input p-0.5', className)}
    >
      {OPTIONS.map((option) => (
        <button
          key={option.unit}
          type="button"
          role="radio"
          aria-checked={unit === option.unit}
          onClick={() => {
            setUnit(option.unit);
          }}
          className="rounded-md px-3 py-1 text-sm font-medium text-muted-foreground transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-checked:bg-primary aria-checked:text-primary-foreground pointer-coarse:min-h-11"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
