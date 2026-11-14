'use client';

import { mayPush } from '@fabric/contracts';
import { PackagePlusIcon, RulerIcon, TriangleAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { messages } from '@/i18n';
import {
  type ProductDetailView,
  useCanSeeCosts,
  useLiveQuery,
  useRepositories,
  useSession,
} from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice } from '@/shared/brand';
import { useMediaQuery } from '@/shared/hooks/use-media-query';
import { useAppNavigation } from '@/shared/lib/navigation';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/shared/ui/drawer';
import { PurchasePaymentDialog } from '@/features/purchasing';
import { type BatchAction, BatchList } from './batch-list';
import { MeasureDialog } from './measure-dialog';
import { MovementHistory } from './movement-history';
import { ProductFacts } from './product-facts';
import { ProductFormDialog } from './product-form-dialog';
import { ProductHeader } from './product-header';
import { ProductSuppliers } from './product-suppliers';
import { QuickAddStockPanel } from './quick-add-stock-panel';
import { RemoveProductDialog } from './remove-product-dialog';
import { useRestockForm } from './restock-form';
import { StockActionDialog } from './stock-action-dialog';
import { StockOverview } from './stock-overview';

const t = messages.productStock;

/** Wide enough for the page and the Quick Add panel side by side (as the till's bill). */
const WIDE = '(min-width: 1024px)';

/**
 * One product (/inventory/product?id=…) as a workspace. On the left, what it is and how it stands:
 * the header, the stock figures, the batches with what each cost, the movements and the details.
 * On the right, Quick Add Stock: a purchase of more of this product, always in view (on a phone
 * and a tablet it is the bar at the bottom, which opens it as a sheet). Adding stock is the
 * restock workflow of the product list (`useRestockForm`): a new batch, never a new product.
 */
export function ProductDetailScreen() {
  const id = useSearchParams().get('id') ?? '';
  const repositories = useRepositories();
  const detail = useLiveQuery(() => repositories.productInventory.detail(id), [repositories, id]);
  const photos = useLiveQuery(() => repositories.photos.sources(), [repositories]);

  if (detail === undefined) return <LoadingState />;
  if (detail === null) {
    return (
      <EmptyState
        title={t.detail.notFound}
        action={
          <Button asChild variant="link" className="justify-self-start px-0">
            <Link href="/inventory">{t.detail.back}</Link>
          </Button>
        }
      />
    );
  }
  return <ProductWorkspace detail={detail} photo={photos?.get(id)} />;
}

function ProductWorkspace({
  detail,
  photo,
}: {
  detail: ProductDetailView;
  photo: string | undefined;
}) {
  const { stock, record, movements, supplierOfPurchase, dueOfPurchase, suppliers } = detail;
  const repositories = useRepositories();
  const navigation = useAppNavigation();
  const seesCosts = useCanSeeCosts();
  const { user } = useSession();
  const canEdit = user !== null && mayPush(user.role, 'product', 'upsert');
  const canBuy = user !== null && mayPush(user.role, 'purchase', 'append');
  const canAct = user !== null && mayPush(user.role, 'product_stock_move', 'append');
  const canRemove = user !== null && mayPush(user.role, 'product', 'void');
  const canEditPayment = user !== null && mayPush(user.role, 'purchase', 'upsert');
  const wide = useMediaQuery(WIDE);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [acting, setActing] = useState<{ action: BatchAction; batchId: string } | null>(null);
  const [payingPurchase, setPayingPurchase] = useState<string | null>(null);
  // The purchase form lives here: what is typed survives the sheet closing and the window resizing.
  const form = useRestockForm(record, () => {
    setSheetOpen(false);
  });

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4">
      <OfflineNotice />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid min-w-0 gap-5">
          <ProductHeader
            stock={stock}
            photo={photo}
            canEdit={canEdit}
            canEditStock={canAct && stock.batches.length > 0}
            canRemove={canRemove}
            onEdit={() => {
              setEditing(true);
            }}
            onEditStock={() => {
              // The batch a sale takes from now: the first that still holds anything.
              const current =
                stock.batches.find(
                  (batch) =>
                    batch.remainingCm > 0 || batch.remainingPieces > 0 || batch.awaitingG > 0,
                ) ?? stock.batches[0];
              if (current) setActing({ action: 'count', batchId: current.batchId });
            }}
            onRemove={() => {
              setRemoving(true);
            }}
          />
          {stock.awaitingMeasurementG > 0 && (
            <Alert>
              <RulerIcon aria-hidden />
              <AlertDescription>{t.detail.awaitingHint}</AlertDescription>
            </Alert>
          )}
          {stock.unreadable.length > 0 && (
            <Alert variant="destructive">
              <TriangleAlertIcon aria-hidden />
              <AlertDescription>
                <span className="font-medium">{t.detail.unreadableTitle}</span>
                {': '}
                {t.detail.unreadableHint}{' '}
                {stock.unreadable.map((batch) => (
                  <bdi key={batch.batchId} dir="ltr" data-num className="me-2">
                    {batch.code}
                  </bdi>
                ))}
              </AlertDescription>
            </Alert>
          )}
          <StockOverview stock={stock} seesCosts={seesCosts} />
          <BatchList
            stock={stock}
            supplierOfPurchase={supplierOfPurchase}
            dueOfPurchase={dueOfPurchase}
            seesCosts={seesCosts}
            canAct={canAct}
            onAction={(action, batchId) => {
              setActing({ action, batchId });
            }}
            onRemnant={(batchId, remnant) => {
              void repositories.stock.setRemnant(batchId, remnant);
            }}
            onEditPayment={canEditPayment ? setPayingPurchase : null}
          />
          {seesCosts && (
            <ProductSuppliers productId={record.id} suppliers={suppliers} canEdit={canEdit} />
          )}
          <MovementHistory
            movements={movements}
            supplierOfPurchase={supplierOfPurchase}
            seesCosts={seesCosts}
          />
          <ProductFacts record={record} stock={stock} />
        </div>
        {canBuy && wide && (
          // Under the app's header (3.5rem) and as tall as what is left of the window, so the
          // total and the button stay in view while the page scrolls.
          <aside className="sticky top-[4.5rem] flex max-h-[calc(100svh-6rem)] flex-col">
            <QuickAddStockPanel form={form} className="max-h-full" />
          </aside>
        )}
      </div>

      {canBuy && !wide && (
        <>
          {/* Room under the last section for the bar below. */}
          <div className="h-16" aria-hidden />
          <div className="fixed inset-x-4 bottom-[calc(var(--bottom-nav,0px)+1rem)] z-20">
            <Button
              type="button"
              variant="accent"
              size="lg"
              className="h-14 w-full touch-manipulation text-base font-semibold pointer-coarse:h-14"
              onClick={() => {
                setSheetOpen(true);
              }}
            >
              <PackagePlusIcon data-icon="inline-start" aria-hidden />
              {t.restock.title}
            </Button>
          </div>
          <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
            <DrawerContent className="h-[88svh] max-h-[88svh]">
              <DrawerHeader className="sr-only">
                <DrawerTitle>{t.restock.title}</DrawerTitle>
                <DrawerDescription>{stock.name}</DrawerDescription>
              </DrawerHeader>
              <div className="flex min-h-0 flex-1 flex-col p-3">
                <QuickAddStockPanel form={form} className="flex-1" />
              </div>
            </DrawerContent>
          </Drawer>
        </>
      )}

      {editing && (
        <ProductFormDialog
          product={record}
          onClose={() => {
            setEditing(false);
          }}
        />
      )}
      {removing && (
        <RemoveProductDialog
          product={stock}
          onClose={() => {
            setRemoving(false);
          }}
          onRemoved={() => {
            navigation.replace('/inventory');
          }}
        />
      )}
      {acting?.action === 'measure' && (
        <MeasureDialog
          batches={stock.batches.filter((batch) => batch.unit !== 'piece')}
          initialBatchId={acting.batchId}
          onClose={() => {
            setActing(null);
          }}
        />
      )}
      {payingPurchase !== null && (
        <PurchasePaymentDialog
          purchaseId={payingPurchase}
          open
          onOpenChange={(open) => {
            if (!open) setPayingPurchase(null);
          }}
        />
      )}
      {(acting?.action === 'loss' || acting?.action === 'count') && (
        <StockActionDialog
          kind={acting.action}
          batches={stock.batches}
          initialBatchId={acting.batchId}
          onClose={() => {
            setActing(null);
          }}
        />
      )}
    </div>
  );
}
