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
import type { SupplierAccountView } from '@/local-db';
import { Avatar } from '@/shared/brand';
import { DateText, Money } from '@/shared/format';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { SupplierStatusBadge } from './supplier-parts';
import { supplierStatusOf } from './supplier-view';

const t = messages.payables;

/**
 * Who the supplier is and what can be done now: pay them (the one gold action, only while the
 * shop owes), send the statement, edit. What only the owner may do is hidden from a partner, who
 * reads everything and changes nothing; archiving waits for a settled account.
 */
export function SupplierHeader({
  view,
  isOwner,
  onPay,
  onShare,
  onEdit,
  onArchive,
}: {
  view: SupplierAccountView;
  isOwner: boolean;
  onPay: () => void;
  onShare: () => void;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const { supplier, account } = view;
  const status = supplierStatusOf(account);
  const canArchive = status === 'settled';
  return (
    <header className="grid gap-3">
      <Button asChild variant="ghost" size="sm" className="-ms-2 justify-self-start">
        <Link href="/payables">
          <ChevronLeftIcon className="rtl:rotate-180" data-icon="inline-start" aria-hidden />
          {t.back}
        </Link>
      </Button>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={supplier.name} className="size-12 text-base" />
          <div className="grid min-w-0 gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-heading text-xl font-semibold break-words">{supplier.name}</h2>
              <SupplierStatusBadge status={status} />
            </div>
            <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
              {supplier.phone && (
                <bdi dir="ltr" data-num>
                  {supplier.phone}
                </bdi>
              )}
              <span>
                {t.since} <DateText value={supplier.createdAt} />
              </span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isOwner && account.owedCents > 0 && (
            <Button variant="accent" size="lg" onClick={onPay}>
              {t.recordPayment}
            </Button>
          )}
          <Button variant="outline" size="lg" onClick={onShare}>
            <SendIcon aria-hidden />
            {t.shareStatement}
          </Button>
          {isOwner && (
            <>
              <Button variant="outline" size="lg" onClick={onEdit}>
                <PencilIcon aria-hidden />
                <span className="max-sm:sr-only">{t.editSupplier}</span>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon-lg" aria-label={t.moreActions}>
                    <MoreHorizontalIcon aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
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
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * The account in three figures: what the shop bought, what it paid (at the till and since), what
 * it still owes. All three are the account's; bought less paid is the balance, and when that is
 * below zero the line under the last figure says the shop paid ahead.
 */
export function AccountSummary({ account }: { account: SupplierAccountView['account'] }) {
  return (
    <dl
      aria-label={t.summary.label}
      className="grid grid-cols-3 rounded-lg border bg-card [&>div+div]:border-s"
    >
      <Figure label={t.summary.purchases} value={<Money cents={account.purchasesCents} />} />
      <Figure label={t.summary.payments} value={<Money cents={account.paidCents} />}>
        <Note>{t.summary.paidNote}</Note>
      </Figure>
      <Figure
        label={t.summary.outstanding}
        value={
          <Money cents={account.owedCents} tone={account.owedCents > 0 ? 'debt' : undefined} />
        }
      >
        {account.advanceCents > 0 && (
          <Note>
            {t.summary.advance}: <Money cents={account.advanceCents} />
          </Note>
        )}
        {account.owedCents === 0 && account.advanceCents === 0 && (
          <Note>{t.summary.settledHint}</Note>
        )}
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
