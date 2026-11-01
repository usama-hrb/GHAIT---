'use client';

import type { NewSaleInput } from '@fabric/contracts';
import { PackageIcon, ShoppingBagIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CustomerDialog } from '@/features/customers';
import { messages } from '@/i18n';
import { useCanSeeCosts, useLiveQuery, useRepositories, ValidationError } from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice } from '@/shared/brand';
import { Money } from '@/shared/format';
import { useMediaQuery } from '@/shared/hooks/use-media-query';
import { shopToday } from '@/shared/lib/dates';
import { useAppNavigation } from '@/shared/lib/navigation';
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
import { type CartItem, pricedItemsOf, saleInputOf } from './cart';
import { CatalogPanel } from './catalog-panel';
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
 * The POS (SPEC §4, §14.5, BUILD_PROMPTS 3.4), laid out for a touch till: the colours that can be
 * sold as tiles, the bill at the side, and number keypads (inside the length, price, payment and
 * discount dialogs) so nothing needs the system keyboard. Every figure comes from @fabric/core
 * through the sales repository; everything is saved on the device first.
 */
export function PosScreen() {
  const repositories = useRepositories();
  const navigation = useAppNavigation();
  // A cashier sees no cost or profit (SPEC §11); the owner and the partner do.
  const seesCosts = useCanSeeCosts();
  const wide = useMediaQuery(WIDE);
  useFoldedMenu();

  const stock = useLiveQuery(() => repositories.inventory.overview(), [repositories]);
  const customers = useLiveQuery(() => repositories.customers.list(), [repositories]);
  const photos = useLiveQuery(() => repositories.photos.sources(), [repositories]);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState<number | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [picking, setPicking] = useState<{
    fabricId: string;
    variantId: string;
    editing: CartItem | null;
  } | null>(null);
  const [discounting, setDiscounting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [completedSaleId, setCompletedSaleId] = useState<string | null>(null);
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
      const cm = item.lines.reduce((sum, line) => sum + line.soldCm, 0);
      map.set(item.variant.id, (map.get(item.variant.id) ?? 0) + cm);
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
  if (cart.length === 0 && !stock.fabrics.some((entry) => entry.remainingCm > 0)) {
    return (
      <EmptyState
        icon={PackageIcon}
        title={t.noStock}
        action={
          <Button asChild>
            <Link href="/purchases/new">{t.newPurchase}</Link>
          </Button>
        }
      />
    );
  }

  const total = priced?.split?.totalCents ?? null;
  const issue = priced?.issues.find(
    (found) => found.message !== 'sale_credit_needs_customer',
  )?.message;
  const pickedStock = picking
    ? stock.fabrics.find((entry) => entry.fabric.id === picking.fabricId)
    : undefined;

  const complete = (input: NewSaleInput) => {
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

        toast.success(t.saved, {
          description: messages.forms.saved,
          duration: 450,
        });
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

  const payFull = () => {
    if (!base || total === null) return;

    // Below-cost sales still require explicit confirmation.
    if (priced?.requiresConfirmation) {
      setPaying(true);
      return;
    }

    complete({
      ...base,
      customerId,
      paidCents: total,
      dueDate: null,
      confirmedBelowCost: false,
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
      seesCosts={seesCosts}
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
        setPicking({ fabricId: item.fabric.id, variantId: item.variant.id, editing: item });
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
          fabrics={stock.fabrics}
          photos={photos}
          inBill={inBill}
          onPick={(fabricId, variantId) => {
            setPicking({ fabricId, variantId, editing: null });
          }}
        />
        {wide && <div className="min-h-0">{bill}</div>}
      </div>

      {!wide && (
        <>
          {/* Room under the last tile for the bar below. */}
          <div className="h-16" aria-hidden />
          <div className="fixed inset-x-4 bottom-20 z-20 md:bottom-4">
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

      {picking && pickedStock && (
        <LineDialog
          key={picking.editing?.key ?? `${picking.variantId}:${String(cart.length)}`}
          fabricStock={pickedStock}
          variantId={picking.variantId}
          photo={photos.get(picking.variantId)}
          others={others}
          editing={picking.editing}
          seesCosts={seesCosts}
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
          requiresConfirmation={priced?.requiresConfirmation === true}
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
