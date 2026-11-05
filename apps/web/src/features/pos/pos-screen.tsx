'use client';

import type { NewSaleInput } from '@fabric/contracts';
import { PackageIcon, ShoppingBagIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CustomerDialog } from '@/features/customers';
import { messages } from '@/i18n';
import { useSellingUnits } from '@/features/settings';
import { useLiveQuery, useRepositories, ValidationError } from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice } from '@/shared/brand';
import { Money } from '@/shared/format';
import { useMediaQuery } from '@/shared/hooks/use-media-query';
import { shopToday } from '@/shared/lib/dates';
import { Button } from '@/shared/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/shared/ui/drawer';
import { useSidebar } from '@/shared/ui/sidebar';
import { BillPanel } from './bill-panel';
import {
  type CartItem,
  itemQuantity,
  needsCostConfirmationAtPayment,
  pricedItemsOf,
  saleInputOf,
} from './cart';
import { CatalogPanel, isSellable } from './catalog-panel';
import { CheckoutDialog } from './checkout-dialog';
import { DiscountDialog } from './discount-dialog';
import { LineDialog } from './line-dialog';

const t = messages.pos;

const issueText = (message: string | undefined) =>
  (message && t.issues[message]) ?? messages.forms.invalid;

/** The bill sits beside the catalog from here up (a tablet on its side, a desktop). */
const WIDE = '(min-width: 1024px)';

/**
 * On a tablet the main menu folds to its icons while selling, so the catalog and the bill have
 * the room; it opens again when the screen is left.
 */
function useFoldedMenu() {
  const { open, setOpen, isMobile } = useSidebar();
  useEffect(() => {
    if (isMobile || window.innerWidth >= 1280) return;
    const fold = open;
    if (fold) setOpen(false);
    return () => {
      if (fold) setOpen(true);
    };
    // Once, on entering the screen: after that the menu is the user's to open and close.
    // eslint-disable-next-line react-hooks/exhaustive-deps, @eslint-react/exhaustive-deps -- see above
  }, []);
}

/**
 * The POS (SPEC §4, §14.5, BUILD_PROMPTS 3.4), laid out for a touch till: the products that can be
 * sold as tiles, the bill at the side, and number keypads (inside the length, price, payment and
 * discount dialogs) so nothing needs the system keyboard. Every figure comes from @fabric/core
 * through the sales repository; everything is saved on the device first.
 */
export function PosScreen() {
  const repositories = useRepositories();
  const wide = useMediaQuery(WIDE);
  useFoldedMenu();

  const stock = useLiveQuery(() => repositories.productInventory.overview(), [repositories]);
  const customers = useLiveQuery(() => repositories.customers.list(), [repositories]);
  const photos = useLiveQuery(() => repositories.photos.sources(), [repositories]);
  const units = useSellingUnits();

  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState<number | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [picking, setPicking] = useState<{
    productId: string;
    editing: CartItem | null;
  } | null>(null);
  const [discounting, setDiscounting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [checkoutMode, setCheckoutMode] = useState<'full' | 'credit'>('full');
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [billOpen, setBillOpen] = useState(false);

  const base = useMemo(
    () => saleInputOf(cart, { date: shopToday(), customerId, discountCents: discount ?? 0 }),
    [cart, customerId, discount],
  );
  // Priced as if nothing were paid yet: the total and the warnings do not depend on the payment.
  const priced = useLiveQuery(async () => {
    if (!base) return null;
    try {
      return await repositories.sales.preview(base);
    } catch {
      return null;
    }
  }, [repositories, base]);
  const items = useMemo(() => pricedItemsOf(cart, priced), [cart, priced]);
  const inBill = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of cart) {
      map.set(item.product.id, (map.get(item.product.id) ?? 0) + itemQuantity(item));
    }
    return map;
  }, [cart]);
  const others = useMemo(
    () => cart.filter((item) => item.key !== picking?.editing?.key),
    [cart, picking],
  );

  if (stock === undefined || customers === undefined || photos === undefined) {
    return <LoadingState />;
  }
  if (cart.length === 0 && !stock.products.some((product) => isSellable(product, units))) {
    return (
      <EmptyState
        icon={PackageIcon}
        title={t.noStock}
        action={
          <Button asChild>
            <Link href="/inventory">{t.addStock}</Link>
          </Button>
        }
      />
    );
  }

  const total = priced?.split?.totalCents ?? null;
  const issue = priced?.issues.find(
    (found) => found.message !== 'sale_credit_needs_customer',
  )?.message;
  const picked = picking
    ? stock.products.find((entry) => entry.id === picking.productId)
    : undefined;

  const complete = (input: NewSaleInput) => {
    // A tap flushes its render before the next one: while a sale is saving, Pay is disabled and a
    // second tap that still arrives makes no second sale.
    if (saving) return;
    setSaving(true);
    repositories.sales
      .create(input)
      .then(() => {
        setSaving(false);
        setPaying(false);

        // Start a fresh sale
        setCart([]);
        setDiscount(null);
        setCustomerId(null);

        toast.success(t.saved, { description: messages.forms.saved, duration: 2000 });
      })
      .catch((error: unknown) => {
        setSaving(false);
        toast.error(
          error instanceof ValidationError
            ? issueText(error.issues[0]?.message)
            : messages.forms.invalid,
        );
      });
  };

  const startPartialPayment = () => {
    setCheckoutMode('credit');
    setPaying(true);
  };

  // A line under its cost was confirmed where it was typed: paying asks only for what no line
  // could (a line nobody confirmed, a discount that takes the invoice under its cost).
  const belowCost = priced?.requiresConfirmation === true;
  const asksCost = needsCostConfirmationAtPayment(items, priced?.split ?? null);

  const payFull = () => {
    if (!base || total === null || saving) return;

    if (asksCost) {
      setCheckoutMode('full');
      setPaying(true);
      return;
    }

    complete({
      ...base,
      customerId,
      paidCents: total,
      dueDate: null,
      // The owner's confirmations on the lines stand for the sale; the server checks it again.
      confirmedBelowCost: belowCost,
      note: null,
    });
  };

  /** Something is opened from the bill: on a small screen the bill drawer gives way to it. */
  const fromBill = (action: () => void) => () => {
    setBillOpen(false);
    action();
  };

  const bill = (
    <BillPanel
      items={items}
      priced={priced}
      saving={saving}
      photos={photos}
      customers={customers}
      customerId={customerId}
      onCustomer={setCustomerId}
      onAddCustomer={fromBill(() => {
        setAddingCustomer(true);
      })}
      discount={discount}
      onDiscount={fromBill(() => {
        setDiscounting(true);
      })}
      onEdit={(item) => {
        setBillOpen(false);
        setPicking({ productId: item.product.id, editing: item });
      }}
      onRemove={(item) => {
        setCart((current) => current.filter((entry) => entry.key !== item.key));
      }}
      onClear={() => {
        setCart([]);
        setDiscount(null);
        setCustomerId(null);
      }}
      onPay={fromBill(payFull)}
      issue={issue ? issueText(issue) : undefined}
      onPartialPay={fromBill(startPartialPayment)}
    />
  );

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100svh-6.5rem)]">
      <OfflineNotice />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-xl font-semibold">{t.title}</h2>
        <Button asChild variant="outline">
          <Link href="/pos/history">{t.history}</Link>
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <CatalogPanel
          products={stock.products}
          units={units}
          photos={photos}
          inBill={inBill}
          onPick={(productId) => {
            setPicking({ productId, editing: null });
          }}
        />
        {wide && <div className="min-h-0">{bill}</div>}
      </div>

      {!wide && (
        <>
          {/* Room under the last tile for the bar below. */}
          <div className="h-16" aria-hidden />
          <div className="fixed inset-x-4 bottom-[calc(var(--bottom-nav,0px)+1rem)] z-20">
            <Button
              type="button"
              variant="accent"
              size="lg"
              className="h-14 w-full touch-manipulation justify-between text-base font-semibold pointer-coarse:h-14"
              onClick={() => {
                setBillOpen(true);
              }}
            >
              <span className="flex items-center gap-2">
                <ShoppingBagIcon aria-hidden />
                {t.bill.open} · {t.bill.items(cart.length)}
              </span>
              {total !== null && <Money cents={total} />}
            </Button>
          </div>
          <Drawer open={billOpen} onOpenChange={setBillOpen}>
            <DrawerContent className="h-[88svh] max-h-[88svh]">
              <DrawerHeader className="sr-only">
                <DrawerTitle>{t.cart}</DrawerTitle>
                <DrawerDescription>{t.bill.items(cart.length)}</DrawerDescription>
              </DrawerHeader>
              <div className="min-h-0 flex-1 p-3">{bill}</div>
            </DrawerContent>
          </Drawer>
        </>
      )}

      {picking && picked && (
        <LineDialog
          key={picking.editing?.key ?? `${picking.productId}:${String(cart.length)}`}
          product={picked}
          photo={photos.get(picking.productId)}
          others={others}
          editing={picking.editing}
          onSubmit={(item) => {
            setCart((current) =>
              current.some((entry) => entry.key === item.key)
                ? current.map((entry) => (entry.key === item.key ? item : entry))
                : [...current, item],
            );
            setPicking(null);
          }}
          onClose={() => {
            setPicking(null);
          }}
        />
      )}
      {discounting && (
        <DiscountDialog
          initial={discount}
          onSubmit={(cents) => {
            setDiscount(cents);
            setDiscounting(false);
          }}
          onClose={() => {
            setDiscounting(false);
          }}
        />
      )}
      {paying && base && total !== null && (
        <CheckoutDialog
          base={base}
          total={total}
          customers={customers}
          customerId={customerId}
          onCustomer={setCustomerId}
          onAddCustomer={() => {
            setAddingCustomer(true);
          }}
          belowCost={belowCost}
          asksConfirmation={asksCost}
          saving={saving}
          onComplete={complete}
          onClose={() => {
            setPaying(false);
          }}
          initialMode={checkoutMode}
        />
      )}
      <CustomerDialog
        open={addingCustomer}
        onOpenChange={setAddingCustomer}
        onSaved={setCustomerId}
      />
    </div>
  );
}
