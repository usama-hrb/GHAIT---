'use client';

import { MoreHorizontalIcon, Share2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { PaymentDialog } from '@/features/customers';
import { isLockedOn, PeriodLockHint, useLockedThrough } from '@/features/settlements';
import { messages } from '@/i18n';
import { type SaleView, useRepositories, useSession } from '@/local-db';
import { VoidDialog } from '@/shared/brand';
import { useMoneyUnit } from '@/shared/format';
import { whatsAppLink } from '@/shared/lib/whatsapp';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { invoiceText } from './invoice-text';
import { ReturnDialog } from './return-dialog';
import { shareInvoice } from './share-invoice';
import { type SaleData, useSale } from './use-sale';

const t = messages.sales;
const h = messages.sales.history;

/** What can be done to a sale that needs a dialog: sharing does not. */
export type SaleAction = 'pay' | 'return' | 'void';

/** What may be done to a sale right now, for whoever is signed in. */
export interface SaleOptions {
  /** A sale that stands can be shared; a voided one has no actions at all. */
  standing: boolean;
  pay: boolean;
  return: boolean;
  /** `blocked`: goods were given back (return the rest instead). `locked`: its period is settled. */
  void: 'ready' | 'blocked' | 'locked' | 'none';
}

/** The one place that says which actions a sale offers: the invoice page, the drawer and the row menu. */
export function saleOptionsOf(
  view: SaleView,
  isOwner: boolean,
  lockedThrough: string | null | undefined,
): SaleOptions {
  const { sale, figures } = view;
  if (sale.voidedAt !== null) return { standing: false, pay: false, return: false, void: 'none' };
  const somethingToReturn = figures.lines.some(
    (entry) =>
      entry.returnedQuantity <
      (view.lines.find((found) => found.line.id === entry.lineId)?.line.quantity ?? 0),
  );
  return {
    standing: true,
    pay: view.customer !== undefined && figures.dueCents > 0,
    return: isOwner && view.writeOff === undefined && somethingToReturn,
    void:
      view.returns.length > 0
        ? 'blocked'
        : isLockedOn(sale.date, lockedThrough)
          ? 'locked'
          : 'ready',
  };
}

function useSaleOptions(view: SaleView) {
  const isOwner = useSession().user?.role === 'owner';
  const lockedThrough = useLockedThrough();
  return { options: saleOptionsOf(view, isOwner, lockedThrough), lockedThrough };
}

/** The invoice as text, shared on the device's share sheet or sent by WhatsApp. */
function useInvoiceShare({ view, shopName }: SaleData) {
  const { unit } = useMoneyUnit();
  const text = invoiceText(view, shopName, unit);
  const link = whatsAppLink(text, view.customer?.phone ?? null);
  return {
    link,
    share: () => {
      shareInvoice(text, link);
    },
  };
}

/**
 * The invoice's actions as buttons (the invoice page, the foot of the details drawer): share,
 * WhatsApp, take a payment, return goods, void. Nothing on a voided sale.
 */
export function SaleActionBar({
  data,
  onAction,
  shareVariant = 'accent',
  className = 'flex flex-wrap gap-2',
}: {
  data: SaleData;
  onAction: (action: SaleAction) => void;
  shareVariant?: 'accent' | 'default';
  className?: string;
}) {
  const { options, lockedThrough } = useSaleOptions(data.view);
  const { link, share } = useInvoiceShare(data);
  if (!options.standing) return null;
  return (
    <div className={className}>
      <Button type="button" variant={shareVariant} size="lg" onClick={share}>
        <Share2Icon aria-hidden />
        {t.share}
      </Button>
      <Button asChild variant="outline" size="lg">
        <a href={link} target="_blank" rel="noopener noreferrer">
          {t.whatsapp}
        </a>
      </Button>
      {options.pay && (
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={() => {
            onAction('pay');
          }}
        >
          {messages.customers.recordPayment}
        </Button>
      )}
      {options.return && (
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={() => {
            onAction('return');
          }}
        >
          {t.returnAction}
        </Button>
      )}
      {options.void === 'blocked' && (
        <p className="ms-auto self-center text-sm text-muted-foreground">{t.voidBlocked}</p>
      )}
      {options.void === 'locked' && (
        <div className="ms-auto">
          <PeriodLockHint date={data.view.sale.date} lockedThrough={lockedThrough} />
        </div>
      )}
      {options.void === 'ready' && (
        <Button
          type="button"
          variant="destructive"
          size="lg"
          className="ms-auto"
          onClick={() => {
            onAction('void');
          }}
        >
          {t.voidAction}
        </Button>
      )}
    </div>
  );
}

/**
 * The actions menu of a row in the sales table. The sale is read when the menu opens, so the list
 * reads nothing per row, and the items come from the same rules as the buttons.
 */
export function SaleActionsMenu({
  saleId,
  label,
  onOpen,
  onAction,
}: {
  saleId: string;
  label: string;
  onOpen: () => void;
  onAction: (action: SaleAction) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          title={h.columns.actions}
          onClick={(event) => {
            // The row opens the drawer on a click: this is not that.
            event.stopPropagation();
          }}
        >
          <MoreHorizontalIcon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onClick={(event) => {
          // The menu is rendered outside the row, but its clicks still reach the row's handler.
          event.stopPropagation();
        }}
      >
        <MenuItems saleId={saleId} onOpen={onOpen} onAction={onAction} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MenuItems({
  saleId,
  onOpen,
  onAction,
}: {
  saleId: string;
  onOpen: () => void;
  onAction: (action: SaleAction) => void;
}) {
  const data = useSale(saleId);
  if (!data) {
    return <DropdownMenuItem onSelect={onOpen}>{h.viewDetails}</DropdownMenuItem>;
  }
  return <LoadedMenuItems data={data} onOpen={onOpen} onAction={onAction} />;
}

function LoadedMenuItems({
  data,
  onOpen,
  onAction,
}: {
  data: SaleData;
  onOpen: () => void;
  onAction: (action: SaleAction) => void;
}) {
  const { options, lockedThrough } = useSaleOptions(data.view);
  const { link, share } = useInvoiceShare(data);
  return (
    <>
      <DropdownMenuItem onSelect={onOpen}>{h.viewDetails}</DropdownMenuItem>
      {options.standing && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={share}>{t.share}</DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={link} target="_blank" rel="noopener noreferrer">
              {t.whatsapp}
            </a>
          </DropdownMenuItem>
        </>
      )}
      {options.pay && (
        <DropdownMenuItem
          onSelect={() => {
            onAction('pay');
          }}
        >
          {messages.customers.recordPayment}
        </DropdownMenuItem>
      )}
      {options.return && (
        <DropdownMenuItem
          onSelect={() => {
            onAction('return');
          }}
        >
          {t.returnAction}
        </DropdownMenuItem>
      )}
      {options.void === 'ready' && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              onAction('void');
            }}
          >
            {t.voidAction}
          </DropdownMenuItem>
        </>
      )}
      {options.void === 'blocked' && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="max-w-64 font-normal text-wrap text-muted-foreground">
            {t.voidBlocked}
          </DropdownMenuLabel>
        </>
      )}
      {options.void === 'locked' && (
        <>
          <DropdownMenuSeparator />
          <div className="max-w-64 px-1.5 py-1">
            <PeriodLockHint date={data.view.sale.date} lockedThrough={lockedThrough} />
          </div>
        </>
      )}
    </>
  );
}

/**
 * The dialog for one action on one sale: take a payment, return goods or void it. Mount it when an
 * action is picked and drop it when the dialog closes; it reads the sale itself.
 */
export function SaleActionDialogs({
  saleId,
  action,
  onClose,
}: {
  saleId: string;
  action: SaleAction;
  onClose: () => void;
}) {
  const repositories = useRepositories();
  const data = useSale(saleId);
  if (!data) return null;
  const { view } = data;
  const { sale, figures } = view;
  const changed = (open: boolean) => {
    if (!open) onClose();
  };
  return (
    <>
      {action === 'pay' && view.customer && (
        <PaymentDialog
          open
          onOpenChange={changed}
          customerId={view.customer.id}
          invoices={[
            {
              saleId: sale.id,
              date: sale.date,
              dueCents: figures.dueCents,
              writtenOff: view.writeOff !== undefined,
            },
          ]}
          defaultTarget={sale.id}
        />
      )}
      {action === 'return' && <ReturnDialog open onOpenChange={changed} view={view} />}
      {action === 'void' && (
        <VoidDialog
          open
          onOpenChange={changed}
          title={t.voidTitle}
          description={t.voidDescription}
          onConfirm={async (reason) => {
            await repositories.sales.voidSale(sale.id, reason);
            onClose();
            toast.success(t.voidedSaved, { description: messages.forms.saved });
          }}
        />
      )}
    </>
  );
}
