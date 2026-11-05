import { initialsOf } from '@/shared/lib/initials';
import { cn } from '@/shared/lib/utils';

/** A person's or a firm's initials in a circle; decoration only (the name is always next to it). */
export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary',
        className,
      )}
    >
      {initialsOf(name) || '?'}
    </span>
  );
}
