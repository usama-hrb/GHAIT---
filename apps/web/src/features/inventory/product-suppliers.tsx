'use client';

import { PlusIcon, XIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { SupplierDialog } from '@/features/payables';
import { messages } from '@/i18n';
import { type ProductSupplierView, useLiveQuery, useRepositories } from '@/local-db';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';

const t = messages.productStock.detail.suppliers;

/**
 * The suppliers this product is bought from: who to reorder it from. The owner adds one from the
 * shop's suppliers (or makes a new one on the spot) and takes one off; each change is a save of the
 * product's own list, offline like any edit. No purchase, cost or debt is touched. The list is the
 * owner's and the partner's to read; a cashier's device holds none.
 */
export function ProductSuppliers({
  productId,
  suppliers,
  canEdit,
}: {
  productId: string;
  suppliers: readonly ProductSupplierView[];
  canEdit: boolean;
}) {
  const repositories = useRepositories();
  const [creating, setCreating] = useState(false);
  const everyone = useLiveQuery(() => repositories.suppliers.list(), [repositories]);
  const addable = (everyone ?? []).filter(
    (supplier) => !suppliers.some((added) => added.id === supplier.id),
  );

  const save = (next: readonly ProductSupplierView[], done: string) => {
    repositories.productInventory
      .setSuppliers(
        productId,
        next.map((supplier) => supplier.id),
      )
      .then(() => {
        toast.success(done);
      })
      .catch(() => {
        toast.error(t.failed);
      });
  };
  const add = (supplier: ProductSupplierView) => {
    save([...suppliers, supplier], t.added(supplier.name));
  };

  return (
    <section aria-labelledby="product-suppliers" className="grid gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 id="product-suppliers" className="me-auto font-heading font-semibold">
          {t.title}
        </h3>
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="pointer-coarse:h-11">
                <PlusIcon data-icon="inline-start" aria-hidden />
                {t.add}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
              {addable.map((supplier) => (
                <DropdownMenuItem
                  key={supplier.id}
                  onSelect={() => {
                    add(supplier);
                  }}
                >
                  {supplier.name}
                </DropdownMenuItem>
              ))}
              {addable.length === 0 && everyone !== undefined && everyone.length > 0 && (
                <DropdownMenuItem disabled>{t.allAdded}</DropdownMenuItem>
              )}
              {everyone !== undefined && everyone.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem
                onSelect={() => {
                  setCreating(true);
                }}
              >
                {t.newSupplier}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{t.hint}</p>
      {suppliers.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          {t.none}
        </p>
      ) : (
        <ul className="divide-y rounded-xl border border-border/70 bg-card shadow-sm">
          {suppliers.map((supplier) => (
            <li key={supplier.id} className="flex items-center gap-3 px-3 py-2">
              <div className="grid min-w-0 flex-1">
                <Link
                  href={`/payables/view?id=${supplier.id}`}
                  className="truncate font-medium underline-offset-4 hover:underline"
                >
                  {supplier.name}
                </Link>
                {supplier.phone && (
                  <bdi dir="ltr" data-num className="text-xs text-muted-foreground">
                    {supplier.phone}
                  </bdi>
                )}
              </div>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="pointer-coarse:size-11"
                  aria-label={t.remove(supplier.name)}
                  onClick={() => {
                    save(
                      suppliers.filter((added) => added.id !== supplier.id),
                      t.removed(supplier.name),
                    );
                  }}
                >
                  <XIcon aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <SupplierDialog
          open={creating}
          onOpenChange={setCreating}
          onSaved={(supplierId) => {
            // Read back from the device: the live list above may not have caught up yet.
            void repositories.suppliers.list().then((all) => {
              const made = all.find((supplier) => supplier.id === supplierId);
              if (made) add({ id: made.id, name: made.name, phone: made.phone });
            });
          }}
        />
      )}
    </section>
  );
}
