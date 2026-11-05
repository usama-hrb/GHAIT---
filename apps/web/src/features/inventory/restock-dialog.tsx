'use client';

import type { Product } from '@fabric/contracts';
import { messages } from '@/i18n';
import type { Local } from '@/local-db';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { RestockFields, useRestockForm } from './restock-form';

const t = messages.productStock;

/**
 * Buys more of a product from the product list. The same workflow as the product page's panel
 * (`useRestockForm`), in a dialog: nothing here decides anything about the purchase.
 */
export function RestockDialog({
  product,
  onClose,
}: {
  product: Local<Product>;
  onClose: () => void;
}) {
  const form = useRestockForm(product, onClose);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t.restock.title} · {product.name}
            </DialogTitle>
            <DialogDescription>{t.restock.description}</DialogDescription>
          </DialogHeader>
          <RestockFields form={form} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {messages.forms.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" variant="accent" disabled={form.saving}>
              {form.saving ? messages.forms.saving : t.restock.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
