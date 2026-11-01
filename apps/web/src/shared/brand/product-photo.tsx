import { ImageIcon } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

/**
 * A colour's picture (ADR 0009) from its `src` (a data: URL kept on the device), or a quiet
 * placeholder while it has none. Decorative: the name is always written beside it. Size it with
 * a class (`size-12`, `aspect-[4/3] w-full`).
 */
export function ProductPhoto({ src, className }: { src: string | undefined; className?: string }) {
  return (
    <span className={cn('relative block shrink-0 overflow-hidden bg-muted', className)}>
      {src ? (
        // A data: URL from the device's own database: next/image has nothing to optimise.
        // eslint-disable-next-line @next/next/no-img-element -- see above
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="size-full object-cover"
        />
      ) : (
        <ImageIcon
          className="absolute inset-0 m-auto size-1/3 max-h-8 max-w-8 text-muted-foreground/50"
          aria-hidden
        />
      )}
    </span>
  );
}
