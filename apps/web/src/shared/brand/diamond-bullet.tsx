import { cn } from '@/shared/lib/utils';

/**
 * The gold diamond from the logo: active-item marker, list bullet, loading mark.
 * Decorative only; sized by font size (0.5em), e.g. `text-xs` for a small one.
 */
export function DiamondBullet({ className }: { className?: string }) {
  return <span aria-hidden className={cn('diamond', className)} />;
}
