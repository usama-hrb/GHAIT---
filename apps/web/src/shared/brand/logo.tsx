import Image from 'next/image';
import { messages } from '@/i18n';
import { cn } from '@/shared/lib/utils';

const SOURCES = {
  full: {
    src: '/brand/logo-full-on-burgundy.png',
    width: 1600,
    height: 1023,
    alt: 'logoAlt',
    // The artwork fills ~54% × 34% of the canvas. Show the middle (2:1, ×1.6), which keeps
    // more clear space than a diamond's height around it (DESIGN_SYSTEM.md §2.7).
    frame: '2 / 1',
    fit: 'object-cover scale-[1.6]',
  },
  mark: {
    src: '/brand/mark-on-burgundy.png',
    width: 489,
    height: 681,
    alt: 'markAlt',
    frame: '489 / 681',
    fit: 'object-contain',
  },
} as const;

/**
 * The غيث logo. It exists only as artwork on burgundy (DESIGN_SYSTEM.md §2.7), so the
 * component brings its own burgundy-800 frame (the PNGs' background colour) and is safe on
 * any surface. Size it with a width or a height class (`w-40`, `h-10`); the aspect ratio is kept.
 */
export function Logo({
  variant = 'full',
  className,
  priority = false,
}: {
  variant?: keyof typeof SOURCES;
  className?: string;
  priority?: boolean;
}) {
  const source = SOURCES[variant];
  return (
    <span
      className={cn('inline-flex shrink-0 overflow-hidden rounded-md bg-burgundy-800', className)}
      style={{ aspectRatio: source.frame }}
    >
      <Image
        src={source.src}
        width={source.width}
        height={source.height}
        alt={messages.brand[source.alt]}
        priority={priority}
        // Static brand art: served as-is so it is cacheable offline and needs no image server.
        unoptimized
        className={cn('size-full', source.fit)}
      />
    </span>
  );
}
