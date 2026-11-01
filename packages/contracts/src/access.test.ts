import { describe, expect, it } from 'vitest';
import {
  ACCESS_ISSUES,
  CASHIER_ACCESS,
  CASHIER_SETTING_KEYS,
  cashierPushIssues,
  mayPush,
  mayRead,
  mayReadCosts,
  redactForRole,
  SYNC_ENTITIES,
  type SyncEntity,
} from './index.js';
import { base, dh } from './test-shop.js';

const entities = Object.keys(SYNC_ENTITIES) as SyncEntity[];

describe('what each role may see and change (SPEC §11, RL1–RL5)', () => {
  it('decides every synced entity for the cashier, and sends no money records', () => {
    expect(Object.keys(CASHIER_ACCESS).sort()).toEqual([...entities].sort());
    const hidden = entities.filter((entity) => !mayRead('cashier', entity));
    // Buying, suppliers, expenses, the partners’ money, settlements, zakat: none of it reaches the till.
    expect(hidden).toEqual(
      expect.arrayContaining([
        'purchase',
        'supplier',
        'supplier_payment',
        'expense',
        'partner',
        'capital_move',
        'partner_draw',
        'settlement',
        'settlement_share',
        'locked_cost',
        'cash_adjustment',
        'zakat_report',
        'write_off',
        'sync_conflict',
      ]),
    );
  });

  it('a cashier pushes sales, payments and customers only; a partner pushes nothing; the owner anything', () => {
    const pushable = entities.filter((entity) =>
      (['append', 'upsert', 'void'] as const).some((kind) => mayPush('cashier', entity, kind)),
    );
    expect(pushable.sort()).toEqual(['customer', 'payment', 'sale']);
    expect(mayPush('cashier', 'sale', 'append')).toBe(true);
    expect(mayPush('cashier', 'sale', 'void')).toBe(false);
    expect(mayPush('cashier', 'customer', 'upsert')).toBe(true);
    expect(mayPush('cashier', 'customer', 'void')).toBe(false);
    expect(mayPush('cashier', 'roll', 'upsert')).toBe(false); // it would overwrite the cost with 0
    expect(mayPush('partner', 'sale', 'append')).toBe(false);
    expect(mayPush('owner', 'purchase', 'append')).toBe(true);
    expect(entities.every((entity) => mayRead('owner', entity) && mayRead('partner', entity))).toBe(
      true,
    );
  });

  it('only a cashier is kept from costs and profit', () => {
    expect([mayReadCosts('owner'), mayReadCosts('partner'), mayReadCosts('cashier')]).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('redacts the roll’s cost for a cashier and leaves the others whole', () => {
    const roll = {
      ...base('2026-10-01'),
      id: crypto.randomUUID(),
      costTotalCents: dh(800),
      lengthCmInitial: 5000,
    };
    expect(redactForRole('cashier', 'roll', roll)).toEqual({ ...roll, costTotalCents: 0 });
    expect(redactForRole('owner', 'roll', roll)).toBe(roll);
    expect(redactForRole('partner', 'roll', roll)).toBe(roll);
    expect(redactForRole('cashier', 'purchase', roll)).toBeNull();
    expect(redactForRole('cashier', 'sale', roll)).toBe(roll);
  });

  it('gives a cashier only the settings the till needs', () => {
    const setting = (key: string) => ({
      ...base('2026-10-01'),
      id: crypto.randomUUID(),
      key,
      value: 1,
      effectiveFrom: null,
    });
    for (const key of CASHIER_SETTING_KEYS) {
      expect(redactForRole('cashier', 'setting', setting(key))).not.toBeNull();
    }
    for (const key of [
      'zakat_gold_price',
      'expense_categories',
      'est_cm_per_kg_policy',
      'unknown_new_one',
    ]) {
      expect(redactForRole('cashier', 'setting', setting(key))).toBeNull();
    }
    expect(redactForRole('owner', 'setting', setting('zakat_gold_price'))).not.toBeNull();
  });

  it('a cashier cannot confirm a sale under cost, nor push a refund', () => {
    expect(cashierPushIssues('sale', { sale: { confirmedBelowCost: true } })).toEqual([
      {
        path: ['sale', 'confirmedBelowCost'],
        message: ACCESS_ISSUES.belowCostByCashier,
        code: 'custom',
      },
    ]);
    expect(cashierPushIssues('sale', { sale: { confirmedBelowCost: false } })).toEqual([]);
    expect(cashierPushIssues('payment', { payment: { kind: 'refund' } })).toEqual([
      { path: ['payment', 'kind'], message: ACCESS_ISSUES.refundByCashier, code: 'custom' },
    ]);
    expect(cashierPushIssues('payment', { payment: { kind: 'payment' } })).toEqual([]);
    expect(cashierPushIssues('customer', {})).toEqual([]);
  });
});
