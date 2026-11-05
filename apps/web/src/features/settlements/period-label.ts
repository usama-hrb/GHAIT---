import { formatDate } from '@/shared/format';
import { isWholeMonth } from './settlement-facts';

/**
 * A period as text: "October 2026" when it is exactly one calendar month, else its first and last
 * day ("3 Oct 2026 – 12 Oct 2026"). Read in the language shown when it is called.
 */
export function periodLabel(start: string, end: string): string {
  return isWholeMonth(start, end)
    ? formatDate(end, 'month')
    : `${formatDate(start, 'medium')} – ${formatDate(end, 'medium')}`;
}
