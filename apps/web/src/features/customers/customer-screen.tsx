'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { useCanSeeCosts, useLiveQuery, useRepositories, ValidationError } from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice, VoidDialog } from '@/shared/brand';
import { DateText, Money, useMoneyUnit } from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';
import { useAppNavigation } from '@/shared/lib/navigation';
import { Button } from '@/shared/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { ActivityTimeline } from './activity-timeline';
import { CustomerDetails } from './customer-details';
import { CustomerDialog } from './customer-dialog';
import { AccountSummary, CustomerHeader } from './customer-header';
import { CustomerOverview } from './customer-overview';
import {
  activityOf,
  invoiceRowsOf,
  isUnpaid,
  paymentRowsOf,
  type InvoiceRow,
} from './customer-view';
import { InvoiceTable } from './invoice-list';
import { PaymentDialog, RefundDialog } from './payment-dialog';
import { PaymentTable } from './payment-list';
import { StatementDialog } from './statement-dialog';
import { statementText } from './statement-text';

const t = messages.customers;
const TABS = ['overview', 'invoices', 'payments', 'activity', 'details'] as const;
type Tab = (typeof TABS)[number];

/**
 * One customer's workspace (/customers/view?id=…): who they are and what they owe on top, then
 * Overview, Invoices, Payments, Activity and Details. Everything is derived from the same account
 * the sell screen and the reports use; this screen only arranges it.
 */
export function CustomerScreen() {
  const id = useSearchParams().get('id') ?? '';
  const repositories = useRepositories();
  const navigation = useAppNavigation();
  const { unit } = useMoneyUnit();
  // A cashier takes payments and edits the customer; credit, refunds, write-offs and archiving
  // are the owner's (RL3).
  const isOwner = useCanSeeCosts();
  const [tab, setTab] = useState<Tab>('overview');
  const [invoiceView, setInvoiceView] = useState<'all' | 'unpaid'>('all');
  const [paying, setPaying] = useState<{ target: string | null } | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [writingOff, setWritingOff] = useState<InvoiceRow | null>(null);
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const data = useLiveQuery(async () => {
    const view = await repositories.accounts.account(id);
    if (!view) return null;
    return {
      view,
      shopName: await repositories.settings.get('shop_name', shopToday()),
      lastActivity:
        (await repositories.accounts.list()).find((row) => row.customer.id === id)?.lastActivity ??
        null,
    };
  }, [repositories, id]);

  const view = data?.view;
  const rows = useMemo(() => (view ? invoiceRowsOf(view) : []), [view]);
  const paymentRows = useMemo(() => (view ? paymentRowsOf(view) : []), [view]);
  const events = useMemo(() => (view ? activityOf(view) : []), [view]);

  if (data === undefined) return <LoadingState rows={5} />;
  if (data === null || !view) {
    return (
      <EmptyState
        title={t.notFound}
        action={
          <Button asChild variant="outline">
            <Link href="/customers">{t.back}</Link>
          </Button>
        }
      />
    );
  }
  const { customer, account } = view;
  const unpaid = rows.filter(isUnpaid).reverse();
  const shown = invoiceView === 'unpaid' ? unpaid.slice().reverse() : rows;
  const invoiceDates = new Map(view.sales.map((sale) => [sale.id, sale.date]));
  const today = shopToday();

  const applyCredit = () => {
    repositories.accounts
      .applyCredit(customer.id)
      .then(() => toast.success(t.creditApplied, { description: messages.forms.saved }))
      .catch((error: unknown) => {
        toast.error(
          (error instanceof ValidationError && t.issues[error.issues[0]?.message ?? '']) ||
            messages.forms.invalid,
        );
      });
  };

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4">
      <OfflineNotice />
      <CustomerHeader
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
        onApplyCredit={applyCredit}
        onRefund={() => {
          setRefunding(true);
        }}
        onArchive={() => {
          setArchiving(true);
        }}
      />
      {customer.voidedAt !== null && (
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
          <CustomerOverview
            unpaid={unpaid}
            payments={paymentRows}
            events={events}
            invoiceDates={invoiceDates}
            onPay={(saleId) => {
              setPaying({ target: saleId });
            }}
            onSeeInvoices={() => {
              setInvoiceView('unpaid');
              setTab('invoices');
            }}
            onSeePayments={() => {
              setTab('payments');
            }}
            onSeeActivity={() => {
              setTab('activity');
            }}
          />
        </TabsContent>

        <TabsContent value="invoices" className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-heading font-semibold">{t.invoices}</h3>
            <Tabs
              value={invoiceView}
              onValueChange={(next) => {
                setInvoiceView(next as 'all' | 'unpaid');
              }}
            >
              <TabsList aria-label={t.invoiceFilter.label}>
                <TabsTrigger value="all" className="px-3">
                  {t.invoiceFilter.all}
                  <span data-num className="text-xs text-muted-foreground">
                    {rows.length}
                  </span>
                </TabsTrigger>
                <TabsTrigger value="unpaid" className="px-3">
                  {t.invoiceFilter.unpaid}
                  <span data-num className="text-xs text-muted-foreground">
                    {unpaid.length}
                  </span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          {shown.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-6 text-center text-muted-foreground">
              {rows.length === 0 ? t.noInvoices : t.noUnpaid}
            </p>
          ) : (
            <InvoiceTable
              rows={shown}
              canWriteOff={isOwner}
              onPay={(saleId) => {
                setPaying({ target: saleId });
              }}
              onWriteOff={setWritingOff}
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
            <PaymentTable rows={paymentRows} />
          )}
        </TabsContent>

        <TabsContent value="activity" className="grid gap-3">
          <h3 className="font-heading font-semibold">{t.activity.title}</h3>
          {events.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-6 text-center text-muted-foreground">
              {t.activity.empty}
            </p>
          ) : (
            <ActivityTimeline events={events} invoiceDates={invoiceDates} />
          )}
        </TabsContent>

        <TabsContent value="details">
          <CustomerDetails
            view={view}
            lastActivity={data.lastActivity}
            onEdit={() => {
              setEditing(true);
            }}
          />
        </TabsContent>
      </Tabs>

      <PaymentDialog
        key={paying?.target ?? 'oldest'}
        open={paying !== null}
        onOpenChange={(next) => {
          if (!next) setPaying(null);
        }}
        customerId={customer.id}
        invoices={account.openInvoices}
        owedCents={account.collectibleCents}
        defaultTarget={paying?.target ?? null}
      />
      <RefundDialog
        open={refunding}
        onOpenChange={setRefunding}
        customerId={customer.id}
        creditCents={account.creditCents}
      />
      <CustomerDialog
        open={editing}
        onOpenChange={setEditing}
        customer={{
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          notes: customer.notes,
        }}
      />
      <StatementDialog
        open={sharing}
        onOpenChange={setSharing}
        text={statementText(view, data.shopName, unit, today)}
        phone={customer.phone}
      />
      <VoidDialog
        open={writingOff !== null}
        onOpenChange={(next) => {
          if (!next) setWritingOff(null);
        }}
        title={t.writeOffTitle}
        description={t.writeOffDescription}
        confirmLabel={t.writeOffConfirm}
        onConfirm={async (reason) => {
          if (writingOff) await repositories.accounts.writeOff(writingOff.sale.id, reason);
          setWritingOff(null);
          toast.success(t.writeOffSaved, { description: messages.forms.saved });
        }}
      >
        {writingOff?.invoice && (
          <p className="flex items-baseline justify-between gap-2 rounded-md bg-muted px-3 py-2 text-sm">
            <span>
              {t.invoiceOf} <DateText value={writingOff.sale.date} />
            </span>
            <Money cents={writingOff.invoice.dueCents} className="font-semibold" />
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
          await repositories.customers.void(customer.id, reason);
          setArchiving(false);
          toast.success(t.archiveSaved, { description: messages.forms.saved });
          navigation.push('/customers');
        }}
      />
    </div>
  );
}
