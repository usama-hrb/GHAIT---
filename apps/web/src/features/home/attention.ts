import type { DuesOverview, ReceivablesOverview, StockAttention } from '@/local-db';

/** Urgent: act today (a sale is lost, money is late, data is not safe). Soon: plan for it. */
export type Severity = 'urgent' | 'soon';

export type AttentionId =
  | 'out_of_stock'
  | 'overdue_debts'
  | 'bills_late'
  | 'sync_issues'
  | 'low_stock'
  | 'unpaid_bills'
  | 'bills_due'
  | 'zakat'
  | 'awaiting';

export interface AttentionItem {
  id: AttentionId;
  severity: Severity;
  count: number;
  /** What it comes to, for the items that are an amount. */
  cents: number | null;
  /** The first few products, for the stock items. */
  names: string[];
  /** The page that shows it, already filtered where the page can be. */
  href: string;
  zakat: NonNullable<DuesOverview['zakat']> | null;
}

/**
 * Most severe first. Out of stock comes before low stock because it loses sales now; late debts and
 * bills before the ones not yet late; refused changes are urgent because they are not on the
 * server. Supplier debts are not here: they have no due date, so they are a figure (the card),
 * not an issue.
 */
const RANK: readonly { id: AttentionId; severity: Severity }[] = [
  { id: 'out_of_stock', severity: 'urgent' },
  { id: 'overdue_debts', severity: 'urgent' },
  { id: 'bills_late', severity: 'urgent' },
  { id: 'sync_issues', severity: 'urgent' },
  { id: 'low_stock', severity: 'soon' },
  { id: 'unpaid_bills', severity: 'soon' },
  { id: 'bills_due', severity: 'soon' },
  { id: 'zakat', severity: 'soon' },
  { id: 'awaiting', severity: 'soon' },
];

export interface AttentionInput {
  /** null: not read (yet, or not for this account). */
  stock: StockAttention | null;
  receivables: ReceivablesOverview | null;
  dues: DuesOverview | null;
  rejectedCount: number;
  /** A cashier is shown no buying, bills, zakat or measuring (SPEC §11). */
  seesCosts: boolean;
}

/** Only what needs doing, ranked: an item with nothing to do is not in the list. */
export function attentionItems(input: AttentionInput): AttentionItem[] {
  const { stock, receivables, dues, rejectedCount, seesCosts } = input;
  const item = (id: AttentionId, partial: Partial<AttentionItem> & { href: string }) => ({
    id,
    severity: RANK.find((rank) => rank.id === id)?.severity ?? 'soon',
    count: 0,
    cents: null,
    names: [],
    zakat: null,
    ...partial,
  });
  const found: AttentionItem[] = [];
  if (stock && stock.outCount > 0) {
    found.push(
      item('out_of_stock', {
        count: stock.outCount,
        names: stock.out,
        href: '/inventory?filter=out',
      }),
    );
  }
  if (receivables && receivables.overdueCount > 0) {
    found.push(
      item('overdue_debts', {
        count: receivables.overdueCount,
        cents: receivables.overdueCents,
        href: '/customers/debts',
      }),
    );
  }
  if (seesCosts && dues && dues.billsLateCount > 0) {
    found.push(item('bills_late', { count: dues.billsLateCount, href: '/expenses#recurring' }));
  }
  if (rejectedCount > 0) {
    found.push(item('sync_issues', { count: rejectedCount, href: '/settings/sync' }));
  }
  if (stock && stock.lowCount > 0) {
    found.push(
      item('low_stock', { count: stock.lowCount, names: stock.low, href: '/inventory?filter=low' }),
    );
  }
  if (seesCosts && dues && dues.unpaidCount > 0) {
    found.push(
      item('unpaid_bills', {
        count: dues.unpaidCount,
        cents: dues.unpaidCents,
        href: '/expenses?status=unpaid',
      }),
    );
  }
  if (seesCosts && dues && dues.billsDueCount > 0) {
    found.push(item('bills_due', { count: dues.billsDueCount, href: '/expenses#recurring' }));
  }
  if (seesCosts && dues?.zakat) {
    found.push(item('zakat', { count: 1, zakat: dues.zakat, href: '/zakat' }));
  }
  if (seesCosts && stock && stock.awaitingCount > 0) {
    found.push(
      item('awaiting', {
        count: stock.awaitingCount,
        names: stock.awaiting,
        href: '/inventory?filter=awaiting',
      }),
    );
  }
  return found.sort(
    (a, b) =>
      RANK.findIndex((rank) => rank.id === a.id) - RANK.findIndex((rank) => rank.id === b.id),
  );
}
