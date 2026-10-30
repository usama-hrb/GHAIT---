import { InboxIcon, type LucideIcon, TriangleAlertIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { messages } from '@/i18n';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Skeleton } from '@/shared/ui/skeleton';
import { DiamondBullet } from './diamond-bullet';

type TitleTag = 'h1' | 'h2' | 'h3' | 'p';

/** Nothing to show yet: say what would be here and offer the action that fills it. */
export function EmptyState({
  icon: Icon = InboxIcon,
  title = messages.states.emptyTitle,
  description,
  action,
  titleAs: Title = 'h2',
  className,
}: {
  icon?: LucideIcon;
  title?: string;
  description?: string;
  action?: ReactNode;
  titleAs?: TitleTag;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-xl border border-dashed border-input px-6 py-10 text-center',
        className,
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Icon className="size-6 text-muted-foreground" aria-hidden />
      </span>
      <Title className="font-heading text-lg font-semibold">{title}</Title>
      {description && <p className="max-w-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}

/** Something failed: explain it and let the user retry. Announced to screen readers. */
export function ErrorState({
  title = messages.states.errorTitle,
  description = messages.states.errorDescription,
  onRetry,
  titleAs: Title = 'h2',
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  titleAs?: TitleTag;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-6 py-10 text-center',
        className,
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
        <TriangleAlertIcon className="size-6 text-destructive" aria-hidden />
      </span>
      <Title className="font-heading text-lg font-semibold">{title}</Title>
      <p className="max-w-sm text-muted-foreground">{description}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          {messages.states.retry}
        </Button>
      )}
    </div>
  );
}

/** Loading placeholder: skeleton rows shaped like the content, or a spinning diamond. */
export function LoadingState({
  variant = 'skeleton',
  rows = 3,
  label = messages.states.loading,
  className,
}: {
  variant?: 'skeleton' | 'spinner';
  rows?: number;
  label?: string;
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" className={cn('w-full', className)}>
      <span className="sr-only">{label}</span>
      {variant === 'spinner' ? (
        <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground" aria-hidden>
          <DiamondBullet className="animate-spin text-2xl [animation-duration:1.6s]" />
          <span className="text-sm">{label}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-3" aria-hidden>
          {Array.from({ length: rows }, (_, row) => (
            <Skeleton key={row} className={cn('h-12 w-full', row === rows - 1 && 'w-2/3')} />
          ))}
        </div>
      )}
    </div>
  );
}
