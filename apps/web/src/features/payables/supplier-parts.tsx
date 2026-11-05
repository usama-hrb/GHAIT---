import { messages } from '@/i18n';
import { Badge } from '@/shared/ui/badge';
import type { PurchaseStatus, SupplierStatus } from './supplier-view';

const t = messages.payables;

/**
 * Owed, overpaid or settled, always as a word. A supplier has no due date, so nothing here is
 * "late": the shop owing is the ordinary state and is not painted as an alarm.
 */
export function SupplierStatusBadge({ status }: { status: SupplierStatus }) {
  if (status === 'owing') return <Badge variant="outline">{t.status.owing}</Badge>;
  return (
    <Badge variant="secondary">{status === 'advance' ? t.status.advance : t.status.settled}</Badge>
  );
}

/** Paid, partly paid or unpaid: always as text, never by colour alone. */
export function PurchaseStatusBadge({ status }: { status: PurchaseStatus }) {
  switch (status) {
    case 'paid':
      return <Badge variant="success">{t.purchaseStatus.paid}</Badge>;
    case 'partlyPaid':
      return <Badge variant="outline">{t.purchaseStatus.partlyPaid}</Badge>;
    case 'unpaid':
      return <Badge variant="outline">{t.purchaseStatus.unpaid}</Badge>;
  }
}
