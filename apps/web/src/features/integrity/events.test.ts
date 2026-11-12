import { describe, expect, it } from 'vitest';
import { messages, setLanguage } from '@/i18n';
import type { RecentEvent } from '@/local-db';
import { amountOf, describeEvent, type EventKey, eventKeyOf } from './events';

type Sort = Pick<RecentEvent, 'entity' | 'kind'>;

describe('eventKeyOf', () => {
  const cases: readonly (readonly [Sort, EventKey])[] = [
    [{ entity: 'sale', kind: null }, 'sale'],
    [{ entity: 'sale_void', kind: null }, 'saleVoid'],
    [{ entity: 'sale_return', kind: null }, 'saleReturn'],
    [{ entity: 'payment', kind: 'payment' }, 'payment'],
    [{ entity: 'payment', kind: 'refund' }, 'refund'],
    [{ entity: 'write_off', kind: null }, 'writeOff'],
    [{ entity: 'purchase', kind: null }, 'purchase'],
    [{ entity: 'supplier_payment', kind: null }, 'supplierPayment'],
    [{ entity: 'expense', kind: 'paid' }, 'expensePaid'],
    [{ entity: 'expense', kind: 'unpaid' }, 'expenseUnpaid'],
    [{ entity: 'product_stock_move', kind: 'loss' }, 'stockLoss'],
    [{ entity: 'product_stock_move', kind: 'length_correction' }, 'stockLength'],
    [{ entity: 'product_stock_move', kind: 'adjustment' }, 'stockCount'],
    [{ entity: 'product_stock_move', kind: 'return' }, 'stockReturn'],
    [{ entity: 'product_stock_move', kind: 'reversal' }, 'stockRestored'],
    [{ entity: 'product_stock_move', kind: 'measurement' }, 'stockMeasured'],
    // A purchase and a sale are listed through their own records, not as stock moves; if one
    // ever arrives here it is still named, plainly.
    [{ entity: 'product_stock_move', kind: 'purchase' }, 'stockMove'],
    [{ entity: 'product_stock_move', kind: 'sale' }, 'stockMove'],
    [{ entity: 'product_stock_move', kind: null }, 'stockMove'],
    [{ entity: 'capital_move', kind: 'contribution' }, 'capitalContribution'],
    [{ entity: 'capital_move', kind: 'withdrawal' }, 'capitalWithdrawal'],
    [{ entity: 'capital_move', kind: 'retained_profit' }, 'retainedProfit'],
    [{ entity: 'partner_draw', kind: null }, 'partnerDraw'],
    [{ entity: 'cash_adjustment', kind: null }, 'cashCount'],
    [{ entity: 'settlement', kind: null }, 'settlement'],
  ];

  it.each(cases)('names %j', (sort, key) => {
    expect(eventKeyOf(sort)).toBe(key);
  });

  it('names every text under integrity.events from at least one sort of change', () => {
    const named = new Set(cases.map(([, key]) => key));
    expect([...named].sort()).toEqual(Object.keys(messages.integrity.events).sort());
  });

  it('has no name for an entity the list does not know', () => {
    expect(eventKeyOf({ entity: 'customer', kind: null })).toBeNull();
    expect(eventKeyOf({ entity: 'product', kind: null })).toBeNull();
  });
});

describe('describeEvent', () => {
  it.each(['en', 'ar'] as const)('says what happened, in words, in %s', (language) => {
    setLanguage(language, { persist: false });
    const labels = new Set<string>();
    for (const key of Object.keys(messages.integrity.events) as EventKey[]) {
      const { label, hint } = messages.integrity.events[key];
      expect(label.length).toBeGreaterThan(2);
      expect(hint.length).toBeGreaterThan(10);
      labels.add(label);
    }
    // Two sorts of change are never given the same name: the list must tell them apart.
    expect(labels.size).toBe(Object.keys(messages.integrity.events).length);
  });

  it('describes a change with its name and what it did', () => {
    setLanguage('en', { persist: false });
    expect(describeEvent({ entity: 'payment', kind: 'refund' })).toEqual({
      label: 'Refund to a customer',
      hint: 'Money paid back to a customer.',
    });
    expect(describeEvent({ entity: 'expense', kind: 'unpaid' }).label).toBe('Expense not paid yet');
  });

  it('follows the language shown now', () => {
    setLanguage('en', { persist: false });
    const english = describeEvent({ entity: 'sale', kind: null }).label;
    setLanguage('ar', { persist: false });
    const arabic = describeEvent({ entity: 'sale', kind: null }).label;
    expect(english).not.toBe(arabic);
  });

  it('falls back to the entity’s own name, with no explanation, for one it does not know', () => {
    setLanguage('en', { persist: false });
    const described = describeEvent({ entity: 'customer', kind: null });
    expect(described.hint).toBeNull();
    expect(described.label).toBe(messages.settings.entities.customer);
    expect(described.label.length).toBeGreaterThan(0);
  });
});

describe('amountOf', () => {
  it('has no amount for a change that moved no money', () => {
    expect(amountOf({ amountCents: null, kind: 'loss' })).toBeNull();
    expect(amountOf({ amountCents: null, kind: null })).toBeNull();
  });

  it('signs an amount as it moves the shop’s money, zero included', () => {
    expect(amountOf({ amountCents: 5_000, kind: 'payment' })).toEqual({
      cents: 5_000,
      signed: true,
    });
    expect(amountOf({ amountCents: -5_000, kind: 'refund' })).toEqual({
      cents: -5_000,
      signed: true,
    });
    expect(amountOf({ amountCents: -5_000, kind: 'paid' })).toEqual({
      cents: -5_000,
      signed: true,
    });
    expect(amountOf({ amountCents: 0, kind: 'payment' })).toEqual({ cents: 0, signed: true });
  });

  it('shows an expense not paid yet without the minus of money going out', () => {
    // The repository signs it as a cost; no money has moved, so the list does not say it left.
    expect(amountOf({ amountCents: -5_000, kind: 'unpaid' })).toEqual({
      cents: 5_000,
      signed: false,
    });
  });
});
