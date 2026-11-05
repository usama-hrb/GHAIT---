'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useLockedThrough } from '@/features/settlements';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories, useSession } from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice, VoidDialog } from '@/shared/brand';
import { DateText, Money, useMoneyUnit } from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';
import { useAppNavigation } from '@/shared/lib/navigation';
import { Button } from '@/shared/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { ActivityTimeline } from './activity-timeline';
import { PaymentTable } from './payment-list';
import { PurchaseTable } from './purchase-list';
import { StatementDialog } from './statement-dialog';
import { statementText } from './statement-text';
import { SupplierDetails } from './supplier-details';
import { SupplierDialog } from './supplier-dialog';
import { AccountSummary, SupplierHeader } from './supplier-header';
import { SupplierOverview } from './supplier-overview';
import { SupplierPaymentDialog } from './supplier-payment-dialog';
import {
  activityOf,
  isUnpaid,
  payablePurchasesOf,
  paymentRowsOf,
  type PaymentRow,
  purchaseRowsOf,
} from './supplier-view';

const t = messages.payables;
const TABS = ['overview', 'purchases', 'payments', 'activity', 'details'] as const;
type Tab = (typeof TABS)[number];

/**
 * One supplier's workspace (/payables/view?id=…): who they are and what the shop owes them on
 * top, then Overview, Purchases, Payments, Activity and Details. Everything is derived from the
 * same account the purchase form, the reports and the zakat read; this screen only arranges it.
 */
export function SupplierScreen() {
  const id = useSearchParams().get('id') ?? '';
  const repositories = useRepositories();
  const navigation = useAppNavigation();
  const { unit } = useMoneyUnit();
  // Paying, voiding a payment, editing and archiving are the owner's; a partner reads everything.
  const isOwner = useSession().user?.role === 'owner';
  const lockedThrough = useLockedThrough();
  const [tab, setTab] = useState<Tab>('overview');
  const [purchaseView, setPurchaseView] = useState<'all' | 'unpaid'>('all');
  const [paying, setPaying] = useState<{ target: string | null } | null>(null);
  const [voiding, setVoiding] = useState<PaymentRow | null>(null);
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const data = useLiveQuery(async () => {
    const view = await repositories.supplierAccounts.account(id);
    if (!view) return null;
    return { view, shopName: await repositories.settings.get('shop_name', shopToday()) };
  }, [repositories, id]);

  const view = data?.view;
  const rows = useMemo(() => (view ? purchaseRowsOf(view) : []), [view]);
  const paymentRows = useMemo(() => (view ? paymentRowsOf(view) : []), [view]);
  const events = useMemo(() => (view ? activityOf(view) : []), [view]);
  const payable = useMemo(() => (view ? payablePurchasesOf(view) : []), [view]);

  if (data === undefined) return <LoadingState rows={5} />;
  if (data === null || !view) {
    return (
      <EmptyState
        title={t.notFound}
        action={
          <Button asChild variant="outline">
            <Link href="/payables">{t.back}</Link>
          </Button>
        }
      />
    );
  }
  const { supplier, account } = view;
  // Oldest first, the order the account settles them; the list shows newest first.
  const unpaid = rows.filter(isUnpaid).reverse();
  const shown = purchaseView === 'unpaid' ? rows.filter(isUnpaid) : rows;
  const today = shopToday();

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4">
      <OfflineNotice />
      <SupplierHeader
        view={view}
        isOwner={isOwner}
        onPay={() => {
          setPaying({ target: null });
        }}
        onShare={() => {
          setSharing(true);
        }}
        onEdit={() => {
          setEditing(true);
        }}
        onArchive={() => {
          setArchiving(true);
        }}
      />
      {supplier.voidedAt !== null && (
        <p role="status" className="rounded-lg border bg-muted px-3 py-2 text-sm">
          {t.archived}
        </p>
      )}
      <AccountSummary account={account} />

      <Tabs
        value={tab}
        onValueChange={(next) => {
          setTab(next as Tab);
        }}
        className="gap-4"
      >
        <TabsList
          variant="line"
          aria-label={t.tabs.label}
          className="w-full justify-start overflow-x-auto border-b"
        >
          {TABS.map((name) => (
            <TabsTrigger key={name} value={name} className="flex-none px-3">
              {t.tabs[name]}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview">
          <SupplierOverview
            unpaid={unpaid}
            payments={paymentRows}
            events={events}
            canPay={isOwner}
            onPay={(purchaseId) => {
              setPaying({ target: purchaseId });
            }}
            onSeePurchases={() => {
              setPurchaseView('unpaid');
              setTab('purchases');
            }}
            onSeePayments={() => {
              setTab('payments');
            }}
            onSeeActivity={() => {
              setTab('activity');
            }}
          />
        </TabsContent>

        <TabsContent value="purchases" className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-heading font-semibold">{t.purchases}</h3>
            <Tabs
              value={purchaseView}
              onValueChange={(next) => {
                setPurchaseView(next as 'all' | 'unpaid');
              }}
            >
              <TabsList aria-label={t.purchaseFilter.label}>
                <TabsTrigger value="all" className="px-3">
                  {t.purchaseFilter.all}
                  <span data-num className="text-xs text-muted-foreground">
                    {rows.length}
                  </span>
                </TabsTrigger>
                <TabsTrigger value="unpaid" className="px-3">
                  {t.purchaseFilter.unpaid}
                  <span data-num className="text-xs text-muted-foreground">
                    {unpaid.length}
                  </span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          {shown.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-6 text-center text-muted-foreground">
              {rows.length === 0 ? t.noPurchases : t.noUnpaid}
            </p>
          ) : (
            <PurchaseTable
              rows={shown}
              canPay={isOwner}
              onPay={(purchaseId) => {
                setPaying({ target: purchaseId });
              }}
            />
          )}
        </TabsContent>

        <TabsContent value="payments" className="grid gap-3">
          <h3 className="font-heading font-semibold">{t.payments}</h3>
          {paymentRows.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-6 text-center text-muted-foreground">
              {t.noPayments}
            </p>
          ) : (
            <PaymentTable
              rows={paymentRows}
              canVoid={isOwner}
              lockedThrough={lockedThrough}
              onVoid={setVoiding}
            />
          )}
        </TabsContent>

        <TabsContent value="activity" className="grid gap-3">
          <h3 className="font-heading font-semibold">{t.activity.title}</h3>
          {events.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-6 text-center text-muted-foreground">
              {t.activity.empty}
            </p>
          ) : (
            <ActivityTimeline events={events} />
          )}
        </TabsContent>

        <TabsContent value="details">
          <SupplierDetails
            view={view}
            canEdit={isOwner}
            onEdit={() => {
              setEditing(true);
            }}
          />
        </TabsContent>
      </Tabs>

      <SupplierPaymentDialog
        open={paying !== null}
        onOpenChange={(next) => {
          if (!next) setPaying(null);
        }}
        supplierId={supplier.id}
        owedCents={account.owedCents}
        purchases={payable}
        defaultTarget={paying?.target ?? null}
      />
      <SupplierDialog
        open={editing}
        onOpenChange={setEditing}
        supplier={{
          id: supplier.id,
          name: supplier.name,
          phone: supplier.phone,
          notes: supplier.notes,
        }}
      />
      <StatementDialog
        open={sharing}
        onOpenChange={setSharing}
        text={statementText(view, data.shopName, unit, today)}
        phone={supplier.phone}
      />
      <VoidDialog
        open={voiding !== null}
        onOpenChange={(next) => {
          if (!next) setVoiding(null);
        }}
        title={t.voidPaymentTitle}
        description={t.voidPaymentDescription}
        onConfirm={async (reason) => {
          if (voiding) await repositories.supplierAccounts.voidPayment(voiding.payment.id, reason);
          setVoiding(null);
          toast.success(t.voidedDone, { description: messages.forms.saved });
        }}
      >
        {voiding && (
          <p className="flex items-baseline justify-between gap-2 rounded-md bg-muted px-3 py-2 text-sm">
            <DateText value={voiding.payment.date} />
            <Money cents={voiding.payment.amountCents} className="font-semibold" />
          </p>
        )}
      </VoidDialog>
      <VoidDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={t.archiveTitle}
        description={t.archiveDescription}
        confirmLabel={t.archiveConfirm}
        onConfirm={async (reason) => {
          await repositories.suppliers.void(supplier.id, reason);
          setArchiving(false);
          toast.success(t.archiveSaved, { description: messages.forms.saved });
          navigation.push('/payables');
        }}
      />
    </div>
  );
}
