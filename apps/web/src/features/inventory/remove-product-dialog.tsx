'use client';

import { PRODUCT_REMOVAL_ISSUES } from '@fabric/contracts';
import { InfoIcon, TriangleAlertIcon } from 'lucide-react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories, ValidationError } from '@/local-db';
import { VoidDialog } from '@/shared/brand';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Skeleton } from '@/shared/ui/skeleton';

const t = messages.productStock.remove;

/**
 * Deleting a product from the inventory (PB20). Nothing is erased: the product is cancelled with a
 * reason, and everything it ever did (purchases, sales, returns, losses) stays in the books. It
 * cannot be cancelled while it still holds stock, and the dialog says so before asking anything.
 * It is saved on the device first and reaches the server through the outbox, which re-checks it.
 */
export function RemoveProductDialog({
  product,
  onClose,
  onRemoved,
}: {
  product: { id: string; name: string; sku: string | null };
  onClose: () => void;
  /** Called once the product is deleted (the product's own page goes back to the list). */
  onRemoved?: () => void;
}) {
  const repositories = useRepositories();
  const removal = useLiveQuery(
    () => repositories.productInventory.removal(product.id),
    [repositories, product.id],
  );
  const blocked = removal?.holdsStock === true;

  return (
    <VoidDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t.title}
      description={`${t.question(product.name)} ${t.description}`}
      confirmLabel={t.confirm}
      busyLabel={t.deleting}
      confirmDisabled={removal == null || blocked}
      onConfirm={async (reason) => {
        try {
          await repositories.productInventory.remove(product.id, reason);
        } catch (error) {
          const holdsStock =
            error instanceof ValidationError &&
            error.issues.some((issue) => issue.message === PRODUCT_REMOVAL_ISSUES.holdsStock);
          toast.error(holdsStock ? t.holdsStock : t.failed);
          return;
        }
        toast.success(t.done(product.name));
        onClose();
        onRemoved?.();
      }}
    >
      <div className="grid gap-1 rounded-lg border bg-muted p-3 text-sm">
        <span className="font-medium">{product.name}</span>
        <span className="text-muted-foreground">
          {t.code}: <bdi>{product.sku ?? t.noCode}</bdi>
        </span>
      </div>
      {removal === undefined ? (
        <Skeleton className="h-16 w-full" aria-label={t.checking} role="status" />
      ) : removal === null ? null : blocked ? (
        <Alert variant="destructive" role="alert">
          <TriangleAlertIcon aria-hidden />
          <AlertDescription>{t.holdsStock}</AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <InfoIcon aria-hidden />
          <AlertDescription>
            <ul className="grid list-disc gap-1 ps-4">
              <li>{t.leaves}</li>
              <li>{removal.batches > 0 ? t.historyKept : t.noHistory}</li>
              <li>{t.recorded}</li>
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </VoidDialog>
  );
}
