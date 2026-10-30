import { formatWeightKg } from '@fabric/core';
import { messages } from '@/i18n';
import { cn } from '@/shared/lib/utils';

/** A weight stored in grams, shown in kilograms: 20500 → "20.5 كغ". */
export function Kilograms({ grams, className }: { grams: number; className?: string }) {
  return (
    <span data-num className={cn('whitespace-nowrap', className)}>
      <bdi>{formatWeightKg(grams)}</bdi>
      {`\u00A0${messages.units.kilogram}`}
    </span>
  );
}
