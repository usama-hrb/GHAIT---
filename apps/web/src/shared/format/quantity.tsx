import { messages } from '@/i18n';
import { cn } from '@/shared/lib/utils';
import { Kilograms } from './kilograms';
import { Meters } from './meters';

/** What stock and sale lines count: a length in cm, a weight in grams, or pieces. */
export type QuantityUnit = 'meter' | 'kg' | 'piece';

/**
 * A quantity in the unit it is counted in: 275 cm → "2.75 م", 20500 g → "20.5 كغ", 3 → "3 قطعة".
 * Lengths and weights are stored as integers and shown only here and in <Meters/>/<Kilograms/>.
 */
export function Quantity({
  unit,
  amount,
  className,
}: {
  unit: QuantityUnit;
  amount: number;
  className?: string;
}) {
  if (unit === 'meter') return <Meters cm={amount} className={className} />;
  if (unit === 'kg') return <Kilograms grams={amount} className={className} />;
  return (
    <span data-num className={cn('whitespace-nowrap', className)}>
      <bdi>{amount}</bdi>
      {`\u00A0${messages.units.piece}`}
    </span>
  );
}
