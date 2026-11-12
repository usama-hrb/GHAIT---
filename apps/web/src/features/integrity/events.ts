import { type Messages, messages } from '@/i18n';
import type { RecentEvent } from '@/local-db';

/** The texts under `integrity.events`: one per sort of change the latest-changes list can show. */
export type EventKey = keyof Messages['integrity']['events'];

/**
 * Which sort of change a recent record is, so the list can name it ("Customer payment", "Stock
 * damaged") instead of its table's name, and say what it did to the shop's money. Null for an
 * entity the list does not know, which then shows the entity's own name.
 */
export function eventKeyOf(event: Pick<RecentEvent, 'entity' | 'kind'>): EventKey | null {
  switch (event.entity) {
    case 'sale':
      return 'sale';
    case 'sale_void':
      return 'saleVoid';
    case 'sale_return':
      return 'saleReturn';
    case 'payment':
      return event.kind === 'refund' ? 'refund' : 'payment';
    case 'write_off':
      return 'writeOff';
    case 'purchase':
      return 'purchase';
    case 'supplier_payment':
      return 'supplierPayment';
    case 'expense':
      return event.kind === 'unpaid' ? 'expenseUnpaid' : 'expensePaid';
    case 'product_stock_move':
      switch (event.kind) {
        case 'loss':
          return 'stockLoss';
        case 'length_correction':
          return 'stockLength';
        case 'adjustment':
          return 'stockCount';
        case 'return':
          return 'stockReturn';
        case 'reversal':
          return 'stockRestored';
        case 'measurement':
          return 'stockMeasured';
        default:
          return 'stockMove';
      }
    case 'capital_move':
      switch (event.kind) {
        case 'withdrawal':
          return 'capitalWithdrawal';
        case 'retained_profit':
          return 'retainedProfit';
        default:
          return 'capitalContribution';
      }
    case 'partner_draw':
      return 'partnerDraw';
    case 'cash_adjustment':
      return 'cashCount';
    case 'settlement':
      return 'settlement';
    default:
      return null;
  }
}

/** What to call a recent change and what it did, in the language shown now. */
export function describeEvent(event: Pick<RecentEvent, 'entity' | 'kind'>): {
  label: string;
  hint: string | null;
} {
  const key = eventKeyOf(event);
  if (key === null) {
    return { label: messages.settings.entities[event.entity] ?? event.entity, hint: null };
  }
  return messages.integrity.events[key];
}

/**
 * How a change's amount is shown. An expense not paid yet counts as a cost but has moved no money,
 * so its amount is shown without the minus sign of money going out; the rest are signed as they
 * move the shop's money. Null: the change has no amount (a stock correction, say).
 */
export function amountOf(
  event: Pick<RecentEvent, 'amountCents' | 'kind'>,
): { cents: number; signed: boolean } | null {
  if (event.amountCents === null) return null;
  if (event.kind === 'unpaid') return { cents: Math.abs(event.amountCents), signed: false };
  return { cents: event.amountCents, signed: true };
}
