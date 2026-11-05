import { cn } from '@/shared/lib/utils';
import { Logo } from './logo';

/** The shop's identity as the frame shows it (ADR 0017). */
export interface BrandIdentity {
  /** The business name; the app's own name while the shop has not set one. */
  name: string;
  /** The shop's own logo as a `data:` URL; null: the built-in brand mark shows. */
  logoSrc: string | null;
}

/**
 * The mark beside the shop's name. The shop's own logo when it has one (on a white tile with an
 * outline, as the owner's picture is made on white); otherwise the built-in brand mark, which
 * brings its own burgundy frame (DESIGN_SYSTEM.md §2.7). `loading` holds the place while the
 * device reads the setting, so the built-in mark does not flash before the shop's own. Size it
 * with a height class (`h-10`).
 */
export function BrandMark({
  logoSrc,
  loading = false,
  alt = '',
  className,
  priority = false,
}: {
  logoSrc: string | null;
  loading?: boolean;
  /** Empty when the name is written beside the mark. */
  alt?: string;
  className?: string;
  priority?: boolean;
}) {
  if (loading) {
    return (
      <span
        aria-hidden
        className={cn('inline-block aspect-[489/681] shrink-0 rounded-lg bg-muted', className)}
      />
    );
  }
  if (logoSrc === null) {
    return <Logo variant="mark" className={cn('rounded-lg', className)} priority={priority} />;
  }
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-white',
        className,
      )}
    >
      {/* A data: URL from the device's own database: next/image has nothing to optimise. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
      <img
        src={logoSrc}
        alt={alt}
        draggable={false}
        className="h-full w-auto max-w-16 object-contain"
      />
    </span>
  );
}
