import type { ProductUnit } from '@fabric/contracts';
import { CheckIcon, CircleXIcon, RulerIcon, TriangleAlertIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { messages } from '@/i18n';
import type { ProductBatchView, StockStatus } from '@/local-db';
import { Kilograms, Meters } from '@/shared/format';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/shared/ui/badge';
import { EstimatedBadge } from './stock-badges';

const t = messages.productStock;

/**
 * A product's stock status: a word and an icon besides the colour. Weight waiting for a length
 * has its own look so that it never reads as stock that is not there.
 */
export function StockStatusBadge({ status }: { status: StockStatus }) {
  switch (status) {
    case 'in_stock':
      return (
        <Badge variant="success">
          <CheckIcon aria-hidden />
          {t.status.in_stock}
        </Badge>
      );
    case 'low':
      return (
        <Badge variant="warning">
          <TriangleAlertIcon aria-hidden />
          {t.status.low}
        </Badge>
      );
    case 'out':
      return (
        <Badge variant="destructive">
          <CircleXIcon aria-hidden />
          {t.status.out}
        </Badge>
      );
    case 'awaiting':
      return <AwaitingBadge />;
  }
}

export function AwaitingBadge() {
  return (
    <Badge variant="secondary">
      <RulerIcon aria-hidden />
      {t.status.awaiting}
    </Badge>
  );
}

/** How sure a batch's length is: bought by the metre (nothing to say), a guess, or measured. */
export function BatchStatusBadge({ status }: { status: ProductBatchView['status'] }) {
  switch (status) {
    case 'estimated':
      return <EstimatedBadge />;
    case 'measured':
      return <Badge variant="success">{t.detail.batchStatus.measured}</Badge>;
    case 'pending':
      return <AwaitingBadge />;
    case 'not_required':
      return null;
  }
}

/** What can be sold: metres, and pieces when there are any. */
export function AvailableText({ cm, pieces }: { cm: number; pieces: number }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      {(cm !== 0 || pieces <= 0) && <Meters cm={cm} />}
      {pieces > 0 && <span data-num>{t.piecesCount(pieces)}</span>}
    </span>
  );
}

/** What a batch holds: weight while its length is unknown, else metres, else pieces. */
export function Holding({ batch }: { batch: ProductBatchView }) {
  if (batch.status === 'pending') return <Kilograms grams={batch.awaitingG} />;
  return <AvailableText cm={batch.remainingCm} pieces={batch.remainingPieces} />;
}

/** "Meter, Piece" in the language shown. */
export function unitNames(units: readonly ProductUnit[]): string {
  return units.map((unit) => t.units[unit]).join(messages.forms.listSeparator);
}

/** One labelled figure of a definition list. */
export function Fact({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid content-start gap-0.5', className)}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
