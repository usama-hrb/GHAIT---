'use client';

import { ChevronLeftIcon, EllipsisIcon, PencilIcon, ScaleIcon, Trash2Icon } from 'lucide-react';
import Link from 'next/link';
import { messages } from '@/i18n';
import type { ProductStockView } from '@/local-db';
import { ProductPhoto } from '@/shared/brand';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { AwaitingBadge, StockStatusBadge } from './product-stock-parts';
import { ReviewBadge } from './stock-badges';

const t = messages.productStock;

/**
 * Who this is and how it stands: photo, name, code and one stock status, with the way back, the
 * edit buttons (the product, and its stock: a count of a batch) and the rarer actions (deleting) in
 * a menu. Adding stock is not here: it is the panel beside the page (or the bar under it on a phone).
 */
export function ProductHeader({
  stock,
  photo,
  canEdit,
  canEditStock,
  canRemove,
  onEdit,
  onEditStock,
  onRemove,
}: {
  stock: ProductStockView;
  photo: string | undefined;
  canEdit: boolean;
  /** The owner may correct the stock, and only a product that has a batch has stock to correct. */
  canEditStock: boolean;
  canRemove: boolean;
  onEdit: () => void;
  onEditStock: () => void;
  onRemove: () => void;
}) {
  return (
    <header className="grid gap-3">
      <Button asChild variant="link" className="justify-self-start px-0">
        <Link href="/inventory">
          <ChevronLeftIcon className="rtl:rotate-180" data-icon="inline-start" aria-hidden />
          {t.detail.back}
        </Link>
      </Button>
      <div className="flex flex-wrap items-center gap-3">
        <ProductPhoto src={photo} className="size-16 rounded-lg" />
        <div className="grid min-w-0 flex-1 gap-1.5">
          <h2 className="truncate font-heading text-xl font-semibold">{stock.name}</h2>
          <span className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            {stock.sku && (
              <bdi dir="ltr" data-num>
                {stock.sku}
              </bdi>
            )}
            <StockStatusBadge status={stock.status} />
            {stock.status !== 'awaiting' && stock.awaitingMeasurementG > 0 && <AwaitingBadge />}
            {stock.needsReview && <ReviewBadge />}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEditStock && (
            <Button variant="outline" onClick={onEditStock}>
              <ScaleIcon data-icon="inline-start" aria-hidden />
              {t.detail.editStock}
            </Button>
          )}
          {canEdit && (
            <Button variant="outline" onClick={onEdit}>
              <PencilIcon data-icon="inline-start" aria-hidden />
              {t.detail.edit}
            </Button>
          )}
          {canRemove && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={t.detail.more}>
                  <EllipsisIcon aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                  <Trash2Icon aria-hidden />
                  {t.actions.remove}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  );
}
