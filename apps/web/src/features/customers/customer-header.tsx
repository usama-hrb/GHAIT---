'use client';

import {
  ArchiveIcon,
  ChevronLeftIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SendIcon,
} from 'lucide-react';
import Link from 'next/link';
import { messages } from '@/i18n';
import type { CustomerAccountView } from '@/local-db';
import { Avatar } from '@/shared/brand';
import { DateText, Money } from '@/shared/format';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { AccountStatusBadge } from './customer-parts';
import { accountStatusOf } from './customer-view';

const t = messages.customers;

/**
 * Who the customer is and what can be done now: take a payment (the one gold action), send the
 * statement, edit. What only the owner may do (credit, refund, archive) is in the "more" menu,
 * which a cashier does not get at all.
 */
export function CustomerHeader({
  view,
  isOwner,
  onPay,
  onShare,
  onEdit,
  onApplyCredit,
  onRefund,
  onArchive,
}: {
  view: CustomerAccountView;
  isOwner: boolean;
  onPay: () => void;
  onShare: () => void;
  onEdit: () => void;
  onApplyCredit: () => void;
  onRefund: () => void;
  onArchive: () => void;
}) {
  const { customer, account } = view;
  const status = accountStatusOf(account);
  const canApplyCredit = account.creditCents > 0 && account.openInvoices.some((i) => !i.writtenOff);
  const canArchive = status === 'settled';
  return (
    <header className="grid gap-3">
      <Button asChild variant="ghost" size="sm" className="-ms-2 justify-self-start">
        <Link href="/customers">
          <ChevronLeftIcon className="rtl:rotate-180" data-icon="inline-start" aria-hidden />
          {t.back}
        </Link>
      </Button>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={customer.name} className="size-12 text-base" />
          <div className="grid min-w-0 gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-heading text-xl font-semibold break-words">{customer.name}</h2>
              <AccountStatusBadge status={status} account={account} />
            </div>
            <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
              {customer.phone && (
                <bdi dir="ltr" data-num>
                  {customer.phone}
                </bdi>
              )}
              <span>
                {t.since} <DateText value={customer.createdAt} />
              </span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="accent" size="lg" onClick={onPay}>
            {t.recordPayment}
          </Button>
          <Button variant="outline" size="lg" onClick={onShare}>
            <SendIcon aria-hidden />
            {t.shareStatement}
          </Button>
          <Button variant="outline" size="lg" onClick={onEdit}>
            <PencilIcon aria-hidden />
            <span className="max-sm:sr-only">{t.editCustomer}</span>
          </Button>
          {isOwner && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon-lg" aria-label={t.moreActions}>
                  <MoreHorizontalIcon aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canApplyCredit && (
                  <DropdownMenuItem onSelect={onApplyCredit}>{t.applyCredit}</DropdownMenuItem>
                )}
                {account.creditCents > 0 && (
                  <DropdownMenuItem onSelect={onRefund}>{t.refund}</DropdownMenuItem>
                )}
                {(canApplyCredit || account.creditCents > 0) && <DropdownMenuSeparator />}
                <DropdownMenuItem disabled={!canArchive} onSelect={onArchive}>
                  <ArchiveIcon aria-hidden />
                  <span className="grid">
                    {t.archive}
                    {!canArchive && (
                      <span className="text-xs text-muted-foreground">{t.archiveBlocked}</span>
                    )}
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * The account in three figures: what the customer bought, what they paid, what is left to collect.
 * All three come from the account; bought less paid is the balance, and when it is not the amount
 * outstanding a line below says why (credit held for them, or a debt written off).
 */
export function AccountSummary({ account }: { account: CustomerAccountView['account'] }) {
  const settled =
    account.collectibleCents === 0 && account.creditCents === 0 && account.writtenOffCents === 0;
  return (
    <dl
      aria-label={t.summary.label}
      className="grid grid-cols-3 rounded-lg border bg-card [&>div+div]:border-s"
    >
      <Figure label={t.summary.purchases} value={<Money cents={account.purchasesCents} />} />
      <Figure label={t.summary.payments} value={<Money cents={account.receivedCents} />}>
        {account.refundedCents > 0 && (
          <Note>
            {t.summary.afterRefunds} <Money cents={account.refundedCents} />
          </Note>
        )}
      </Figure>
      <Figure
        label={t.summary.outstanding}
        value={
          <Money
            cents={account.collectibleCents}
            tone={account.collectibleCents > 0 ? 'debt' : undefined}
          />
        }
      >
        {account.overdueCents > 0 && (
          <Note>
            {t.account.overdue}: <Money cents={account.overdueCents} />
          </Note>
        )}
        {account.creditCents > 0 && (
          <Note>
            {t.account.credit}: <Money cents={account.creditCents} />
          </Note>
        )}
        {account.writtenOffCents > 0 && (
          <Note>
            {t.account.writtenOff}: <Money cents={account.writtenOffCents} />
          </Note>
        )}
        {settled && <Note>{t.summary.settledHint}</Note>}
      </Figure>
    </dl>
  );
}

function Figure({
  label,
  value,
  children,
}: {
  label: string;
  value: React.ReactNode;
  /** Lines under the figure that say what it leaves out (`Note`s). */
  children?: React.ReactNode;
}) {
  return (
    <div className="grid content-start gap-0.5 px-3 py-3 sm:px-4">
      <dt className="text-xs text-muted-foreground sm:text-sm">{label}</dt>
      <dd className="font-heading text-lg font-semibold sm:text-2xl">{value}</dd>
      {children}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <dd className="text-xs text-muted-foreground">{children}</dd>;
}
