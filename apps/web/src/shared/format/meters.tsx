import { formatLengthMeters } from '@fabric/core';
import { messages } from '@/i18n';
import { cn } from '@/shared/lib/utils';

/** A length stored in cm, shown in metres: 275 → "2.75 م". */
export function Meters({ cm, className }: { cm: number; className?: string }) {
  return (
    <span data-num className={cn('whitespace-nowrap', className)}>
      <bdi>{formatLengthMeters(cm)}</bdi>
      {`\u00A0${messages.units.meter}`}
    </span>
  );
}
