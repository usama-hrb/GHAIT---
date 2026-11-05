import { describe, expect, it } from 'vitest';
import type { DuesOverview, ReceivablesOverview, StockAttention } from '@/local-db';
import { attentionItems } from './attention';

const stock: StockAttention = {
  outCount: 2,
  lowCount: 3,
  awaitingCount: 1,
  out: ['حرير', 'قطن'],
  low: ['ساتان'],
  awaiting: ['كتان'],
};
const receivables: ReceivablesOverview = {
  owedCents: 90_000,
  owingCount: 4,
  overdueCents: 40_000,
  overdueCount: 2,
};
const dues: DuesOverview = {
  unpaidCents: 25_000,
  unpaidCount: 2,
  billsDueCount: 1,
  billsLateCount: 1,
  zakat: { kind: 'upcoming', hawlDate: '2026-12-01', days: 20 },
};
const owner = { stock, receivables, dues, rejectedCount: 3, seesCosts: true };

describe('what needs attention', () => {
  it('ranks by severity: urgent first (stock out, late debts, late bills, refused changes), then soon', () => {
    const items = attentionItems(owner);
    expect(items.map((item) => [item.id, item.severity])).toEqual([
      ['out_of_stock', 'urgent'],
      ['overdue_debts', 'urgent'],
      ['bills_late', 'urgent'],
      ['sync_issues', 'urgent'],
      ['low_stock', 'soon'],
      ['unpaid_bills', 'soon'],
      ['bills_due', 'soon'],
      ['zakat', 'soon'],
      ['awaiting', 'soon'],
    ]);
  });

  it('carries the counts, amounts and names, and a link to the page that shows them', () => {
    const items = new Map(attentionItems(owner).map((item) => [item.id, item]));
    expect(items.get('out_of_stock')).toMatchObject({
      count: 2,
      names: ['حرير', 'قطن'],
      href: '/inventory?filter=out',
    });
    expect(items.get('low_stock')).toMatchObject({ count: 3, href: '/inventory?filter=low' });
    expect(items.get('awaiting')).toMatchObject({ href: '/inventory?filter=awaiting' });
    expect(items.get('overdue_debts')).toMatchObject({
      count: 2,
      cents: 40_000,
      href: '/customers/debts',
    });
    expect(items.get('unpaid_bills')).toMatchObject({
      count: 2,
      cents: 25_000,
      href: '/expenses?status=unpaid',
    });
    expect(items.get('sync_issues')).toMatchObject({ count: 3, href: '/settings/sync' });
    expect(items.get('zakat')).toMatchObject({ href: '/zakat', zakat: { kind: 'upcoming' } });
  });

  it('has no item for what is fine: nothing to do is an empty list', () => {
    expect(
      attentionItems({
        stock: { ...stock, outCount: 0, lowCount: 0, awaitingCount: 0 },
        receivables: { ...receivables, overdueCount: 0, overdueCents: 0 },
        dues: { ...dues, unpaidCount: 0, billsDueCount: 0, billsLateCount: 0, zakat: null },
        rejectedCount: 0,
        seesCosts: true,
      }),
    ).toEqual([]);
  });

  it('does not list supplier debts: they have no due date, so they are a figure on the card', () => {
    expect(attentionItems(owner).map((item) => item.id)).not.toContain('supplier_debts');
  });

  it('shows a cashier no bills, zakat or measuring, only stock, late customers and refused changes', () => {
    const items = attentionItems({ ...owner, dues: null, seesCosts: false });
    expect(items.map((item) => item.id)).toEqual([
      'out_of_stock',
      'overdue_debts',
      'sync_issues',
      'low_stock',
    ]);
    // Even handed the owner's figures by mistake, a cashier is never shown the costs side.
    expect(attentionItems({ ...owner, seesCosts: false }).map((item) => item.id)).toEqual([
      'out_of_stock',
      'overdue_debts',
      'sync_issues',
      'low_stock',
    ]);
  });

  it('skips a section that is not read yet', () => {
    expect(
      attentionItems({
        stock: null,
        receivables: null,
        dues: null,
        rejectedCount: 0,
        seesCosts: true,
      }),
    ).toEqual([]);
  });
});
