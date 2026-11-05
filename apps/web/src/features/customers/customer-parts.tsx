import type { CustomerAccount } from '@fabric/core';
import { messages } from '@/i18n';
import { Badge } from '@/shared/ui/badge';
import type { AccountStatus, InvoiceStatus } from './customer-view';

const t = messages.customers;

/**
 * Owes, in credit or settled, always as a word. Late payment is the one thing that earns the
 * alarming colour, so a list of debtors is not a wall of red.
 */
export function AccountStatusBadge({
  status,
  account,
}: {
  status: AccountStatus;
  account: Pick<CustomerAccount, 'overdueCents' | 'writtenOffCents'>;
}) {
  if (status === 'owing') {
    return account.overdueCents > 0 ? (
      <Badge variant="destructive">{t.status.overdue}</Badge>
    ) : (
      <Badge variant="outline">{t.account.status.owing}</Badge>
    );
  }
  // Nothing more is expected from them, but a debt was written off: say so, not "settled".
  if (status === 'settled' && account.writtenOffCents > 0) {
    return <Badge variant="secondary">{t.status.writtenOff}</Badge>;
  }
  return (
    <Badge variant="secondary">
      {status === 'credit' ? t.account.status.credit : t.account.status.settled}
    </Badge>
  );
}

/** Paid, unpaid, partly paid, overdue, bad debt or voided: always as text, never by colour alone. */
export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  switch (status) {
    case 'paid':
      return <Badge variant="success">{t.status.paid}</Badge>;
    case 'unpaid':
      return <Badge variant="outline">{t.status.unpaid}</Badge>;
    case 'partlyPaid':
      return <Badge variant="outline">{t.status.partlyPaid}</Badge>;
    case 'overdue':
      return <Badge variant="destructive">{t.status.overdue}</Badge>;
    case 'writtenOff':
      return <Badge variant="secondary">{t.status.writtenOff}</Badge>;
    case 'voided':
      return <Badge variant="secondary">{t.status.voided}</Badge>;
  }
}
