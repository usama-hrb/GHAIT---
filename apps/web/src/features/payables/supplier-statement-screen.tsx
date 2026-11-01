'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { isLockedOn, PeriodLockHint, useLockedThrough } from '@/features/settlements';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories, useSession } from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice, VoidDialog } from '@/shared/brand';
import { DateText, Money } from '@/shared/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { SupplierPaymentDialog } from './supplier-payment-dialog';

const t = messages.payables;

/** One supplier's account (/payables/view?id=…): the statement, the purchases and the payments. */
export function SupplierStatementScreen() {
  const id = useSearchParams().get('id') ?? '';
  const repositories = useRepositories();
  const session = useSession();
  const isOwner = session.user?.role === 'owner';
  const lockedThrough = useLockedThrough();
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);
  const view = useLiveQuery(
    async () => (await repositories.supplierAccounts.statement(id)) ?? null,
    [repositories, id],
  );

  if (view === undefined) return <LoadingState />;
  if (view === null) {
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
  const { supplier, account, statement, purchases, payments } = view;
  const dateOfPurchase = new Map(purchases.map((purchase) => [purchase.id, purchase.date]));

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4">
      <OfflineNotice />
      <Button asChild variant="link" className="justify-self-start px-0">
        <Link href="/payables">{t.back}</Link>
      </Button>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-heading text-xl font-semibold">{supplier.name}</h2>
        <p>
          <span className="text-muted-foreground">
            {account.owedCents > 0 ? t.owed : t.advance}:{' '}
          </span>
          <Money
            cents={account.owedCents > 0 ? account.owedCents : account.advanceCents}
            tone={account.owedCents > 0 ? 'debt' : undefined}
            className="text-lg font-semibold"
          />
        </p>
      </div>
      {isOwner && account.owedCents > 0 && (
        <div>
          <Button
            type="button"
            variant="accent"
            size="lg"
            onClick={() => {
              setPaying(true);
            }}
          >
            {t.pay}
          </Button>
        </div>
      )}

      <section aria-label={t.statementTitle} className="grid gap-2">
        <h3 className="font-heading font-semibold">{t.statementTitle}</h3>
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.columns.date}</TableHead>
                <TableHead>{t.columns.kind}</TableHead>
                <TableHead className="text-end">{t.columns.amount}</TableHead>
                <TableHead className="text-end">{t.columns.balance}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statement.map((line) => (
                <TableRow key={`${line.kind}-${line.refId}`}>
                  <TableCell>
                    <DateText value={line.date} />
                  </TableCell>
                  <TableCell>{t.statement[line.kind]}</TableCell>
                  <TableCell className="text-end">
                    <Money cents={Math.abs(line.deltaCents)} />
                    <span className="sr-only">{line.deltaCents < 0 ? '−' : '+'}</span>
                  </TableCell>
                  <TableCell className="text-end">
                    <Money cents={line.balanceCents} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {account.purchases.length > 0 && (
        <section aria-label={t.purchasesTitle} className="grid gap-2">
          <h3 className="font-heading font-semibold">{t.purchasesTitle}</h3>
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.columns.purchase}</TableHead>
                  <TableHead className="text-end">{t.columns.total}</TableHead>
                  <TableHead className="text-end max-sm:hidden">{t.columns.paid}</TableHead>
                  <TableHead className="text-end">{t.columns.due}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {account.purchases.map((purchase) => (
                  <TableRow key={purchase.purchaseId}>
                    <TableCell>
                      <Link
                        href={`/purchases/view?id=${purchase.purchaseId}`}
                        className="underline-offset-4 hover:underline"
                      >
                        <DateText
                          value={dateOfPurchase.get(purchase.purchaseId) ?? purchase.date}
                        />
                      </Link>
                    </TableCell>
                    <TableCell className="text-end">
                      <Money cents={purchase.totalCents} />
                    </TableCell>
                    <TableCell className="text-end max-sm:hidden">
                      <Money cents={purchase.settledCents} />
                    </TableCell>
                    <TableCell className="text-end">
                      {purchase.dueCents > 0 ? (
                        <Money cents={purchase.dueCents} tone="debt" />
                      ) : (
                        <Badge variant="secondary">{messages.purchasing.paid}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      <section aria-label={t.paymentsTitle} className="grid gap-2">
        <h3 className="font-heading font-semibold">{t.paymentsTitle}</h3>
        {payments.length === 0 ? (
          <p className="text-muted-foreground">{t.noPayments}</p>
        ) : (
          <ul className="grid gap-2">
            {payments.map((payment) => (
              <li
                key={payment.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3 text-sm"
              >
                <span className="flex items-center gap-2">
                  <DateText value={payment.date} />
                  <span className="text-muted-foreground">{t.methods[payment.method]}</span>
                  {payment.voidedAt !== null && (
                    <Badge variant="destructive">{messages.sales.voided}</Badge>
                  )}
                </span>
                <span className="flex items-center gap-3">
                  <Money cents={payment.amountCents} />
                  {isOwner &&
                    payment.voidedAt === null &&
                    (isLockedOn(payment.date, lockedThrough) ? (
                      <PeriodLockHint date={payment.date} lockedThrough={lockedThrough} />
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setVoiding(payment.id);
                        }}
                      >
                        {t.voidPayment}
                      </Button>
                    ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SupplierPaymentDialog
        open={paying}
        onOpenChange={setPaying}
        supplierId={supplier.id}
        owedCents={account.owedCents}
        purchases={account.purchases.filter((purchase) => purchase.dueCents > 0)}
      />
      <VoidDialog
        open={voiding !== null}
        onOpenChange={(open) => {
          if (!open) setVoiding(null);
        }}
        title={t.voidPaymentTitle}
        description={t.voidPaymentDescription}
        onConfirm={async (reason) => {
          if (voiding === null) return;
          await repositories.supplierAccounts.voidPayment(voiding, reason);
          setVoiding(null);
          toast.success(t.voidedDone, { description: messages.forms.saved });
        }}
      />
    </div>
  );
}
