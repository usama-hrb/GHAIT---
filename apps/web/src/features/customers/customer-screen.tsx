'use client';

import type { AccountInvoice } from '@fabric/core';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories, ValidationError } from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice, VoidDialog } from '@/shared/brand';
import { DateAr, Money, useMoneyUnit } from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';
import { whatsAppLink } from '@/shared/lib/whatsapp';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { Balance } from './customers-screen';
import { PaymentDialog, RefundDialog } from './payment-dialog';
import { statementText } from './statement-text';

const t = messages.customers;

/** One customer's account (/customers/view?id=…): invoices, payments, credit and write-offs. */
export function CustomerScreen() {
  const id = useSearchParams().get('id') ?? '';
  const repositories = useRepositories();
  const { unit } = useMoneyUnit();
  const [paying, setPaying] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [writingOff, setWritingOff] = useState<string | null>(null);
  const data = useLiveQuery(async () => {
    const view = await repositories.accounts.account(id);
    if (!view) return null;
    return { view, shopName: await repositories.settings.get('shop_name', shopToday()) };
  }, [repositories, id]);

  if (data === undefined) return <LoadingState />;
  if (data === null) {
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
  const { view, shopName } = data;
  const { customer, account } = view;
  const today = shopToday();
  const open = new Map(account.openInvoices.map((invoice) => [invoice.saleId, invoice]));
  const collectible = account.openInvoices.filter((invoice) => !invoice.writtenOff);
  const statement = whatsAppLink(statementText(view, shopName, unit, today), customer.phone);

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
    <div className="mx-auto grid w-full max-w-4xl gap-4">
      <OfflineNotice />
      <Button asChild variant="link" className="justify-self-start px-0">
        <Link href="/customers">{t.back}</Link>
      </Button>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-heading text-xl font-semibold">{customer.name}</h2>
        {customer.phone && (
          <bdi dir="ltr" data-num className="text-muted-foreground">
            {customer.phone}
          </bdi>
        )}
      </div>

      <dl className="grid gap-x-6 gap-y-2 rounded-lg border bg-card p-4 sm:grid-cols-2">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{t.account.collectible}</dt>
          <dd className="font-semibold">
            <Money
              cents={account.collectibleCents}
              tone={account.collectibleCents > 0 ? 'debt' : undefined}
            />
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{t.account.balance}</dt>
          <dd>
            <Balance cents={account.balanceCents} />
          </dd>
        </div>
        {account.creditCents > 0 && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t.account.credit}</dt>
            <dd>
              <Money cents={account.creditCents} tone="capital" />
            </dd>
          </div>
        )}
        {account.overdueCents > 0 && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t.account.overdue}</dt>
            <dd>
              <Money cents={account.overdueCents} tone="loss" />
            </dd>
          </div>
        )}
        {account.writtenOffCents > 0 && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t.account.writtenOff}</dt>
            <dd>
              <Money cents={account.writtenOffCents} />
            </dd>
          </div>
        )}
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="accent"
          size="lg"
          onClick={() => {
            setPaying(true);
          }}
        >
          {t.recordPayment}
        </Button>
        <Button asChild variant="outline" size="lg">
          <a href={statement} target="_blank" rel="noopener noreferrer">
            {t.shareStatement}
          </a>
        </Button>
        {account.creditCents > 0 && collectible.length > 0 && (
          <Button variant="outline" size="lg" onClick={applyCredit}>
            {t.applyCredit}
          </Button>
        )}
        {account.creditCents > 0 && (
          <Button
            variant="outline"
            size="lg"
            onClick={() => {
              setRefunding(true);
            }}
          >
            {t.refund}
          </Button>
        )}
      </div>

      <section aria-label={t.invoices} className="grid gap-2">
        <h3 className="font-heading font-semibold">{t.invoices}</h3>
        {view.sales.length === 0 ? (
          <p className="text-muted-foreground">{t.noInvoices}</p>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.columns.date}</TableHead>
                  <TableHead className="text-end">{t.columns.total}</TableHead>
                  <TableHead className="text-end">{t.columns.due}</TableHead>
                  <TableHead>{t.columns.status}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t.writeOff}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.sales.map((sale) => {
                  const invoice = open.get(sale.id);
                  return (
                    <TableRow key={sale.id} className="h-12">
                      <TableCell>
                        <Link
                          href={`/pos/view?id=${sale.id}`}
                          className="underline-offset-4 hover:underline"
                        >
                          <DateAr value={sale.date} />
                        </Link>
                      </TableCell>
                      <TableCell className="text-end">
                        <Money cents={sale.totalCents} />
                      </TableCell>
                      <TableCell className="text-end">
                        {invoice ? <Money cents={invoice.dueCents} tone="debt" /> : '—'}
                      </TableCell>
                      <TableCell>
                        <InvoiceStatus voided={sale.voidedAt !== null} invoice={invoice} />
                      </TableCell>
                      <TableCell className="text-end">
                        {invoice && !invoice.writtenOff && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setWritingOff(sale.id);
                            }}
                          >
                            {t.writeOff}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section aria-label={t.payments} className="grid gap-2">
        <h3 className="font-heading font-semibold">{t.payments}</h3>
        {view.payments.length === 0 ? (
          <p className="text-muted-foreground">{t.noPayments}</p>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.columns.date}</TableHead>
                  <TableHead>{t.columns.kind}</TableHead>
                  <TableHead className="max-sm:hidden">{t.columns.method}</TableHead>
                  <TableHead className="text-end">{t.columns.amount}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.payments.map((payment) => (
                  <TableRow key={payment.id} className="h-12">
                    <TableCell>
                      <DateAr value={payment.date} />
                    </TableCell>
                    <TableCell>{t.kinds[payment.kind]}</TableCell>
                    <TableCell className="max-sm:hidden">{t.methods[payment.method]}</TableCell>
                    <TableCell className="text-end">
                      <Money
                        cents={payment.amountCents}
                        tone={payment.kind === 'payment' ? 'profit' : undefined}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <PaymentDialog
        open={paying}
        onOpenChange={setPaying}
        customerId={customer.id}
        invoices={account.openInvoices}
      />
      <RefundDialog
        open={refunding}
        onOpenChange={setRefunding}
        customerId={customer.id}
        creditCents={account.creditCents}
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
          if (writingOff) await repositories.accounts.writeOff(writingOff, reason);
          setWritingOff(null);
          toast.success(t.writeOffSaved, { description: messages.forms.saved });
        }}
      />
    </div>
  );
}

/** Paid, open, overdue, written off or voided: always as text, never by colour alone. */
function InvoiceStatus({
  voided,
  invoice,
}: {
  voided: boolean;
  invoice: AccountInvoice | undefined;
}) {
  if (voided) return <Badge variant="secondary">{t.status.voided}</Badge>;
  if (!invoice) return <Badge variant="success">{t.status.paid}</Badge>;
  if (invoice.writtenOff) return <Badge variant="outline">{t.status.writtenOff}</Badge>;
  if (invoice.overdue) return <Badge variant="destructive">{t.status.overdue}</Badge>;
  return <Badge variant="warning">{t.status.open}</Badge>;
}
