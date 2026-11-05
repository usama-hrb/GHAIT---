import { supplierAccountOf, supplierStatementOf } from '@fabric/contracts';
import { describe, expect, it } from 'vitest';
import { setLanguage } from '@/i18n';
import type { SupplierAccountView } from '@/local-db';
import { statementText } from './statement-text';

let counter = 0;
const base = (createdAt = '2026-10-01T09:00:00.000Z') => ({
  id: `id-${String(++counter)}`,
  createdAt,
  updatedAt: createdAt,
  deviceId: 'A',
  voidedAt: null,
  serverSeq: null,
});

type Records = Pick<SupplierAccountView, 'purchases' | 'payments'>;

const purchase = (
  fields: { totalCostCents: number; paidCents?: number; date: string },
  productNames: string[] = ['حرير'],
): Records['purchases'][number] => ({
  purchase: {
    ...base(),
    supplierId: 's1',
    method: 'meter',
    pricePerMeterCents: null,
    weightG: null,
    estCmPerKg: null,
    notes: null,
    paidCents: 0,
    ...fields,
  },
  productNames,
  batchCodes: ['A00001'],
});

const payment = (amountCents: number, date: string): Records['payments'][number] => ({
  ...base(),
  supplierId: 's1',
  purchaseId: null,
  method: 'cash',
  note: null,
  amountCents,
  date,
});

const viewOf = (records: Partial<Records>): SupplierAccountView => {
  const full: Records = { purchases: [], payments: [], ...records };
  const counted = {
    purchases: full.purchases.map((row) => row.purchase),
    payments: full.payments,
  };
  return {
    supplier: { ...base(), name: 'مورد الحرير', phone: null, notes: null },
    account: supplierAccountOf('s1', counted),
    statement: supplierStatementOf('s1', counted),
    lastActivity: null,
    ...full,
  };
};

describe('statementText', () => {
  it('lists what is still owed, what the shop owes, and the movements from opening to closing', () => {
    setLanguage('en', { persist: false });
    const text = statementText(
      viewOf({
        purchases: [
          purchase({ totalCostCents: 4000, paidCents: 1000, date: '2026-10-01' }, ['Silk']),
        ],
        payments: [payment(500, '2026-10-10')],
      }),
      'Ghaith',
      'rial',
      '2026-10-30',
    );
    expect(text.split('\n')).toEqual([
      'Ghaith',
      'Account statement · مورد الحرير · 30 October 2026',
      '',
      'Purchases still owed:',
      '• Purchase 1 October 2026 (Silk): Cost 800 rial · Paid 300 rial · Remaining 500 rial',
      '',
      'We owe: 500 rial',
      '',
      'Latest movements:',
      'Balance before: 0 rial',
      '• 1 October 2026: Purchase 800 rial · Balance 800 rial',
      '• 1 October 2026: Paid at purchase 200 rial · Balance 600 rial',
      '• 10 October 2026: Payment 100 rial · Balance 500 rial',
      'Balance: 500 rial',
      '',
      'Thank you.',
    ]);
  });

  it('closes on the account balance, whatever the window shows', () => {
    setLanguage('en', { persist: false });
    // Twelve purchases of 10 dh each: only the latest ten movements are listed.
    const view = viewOf({
      purchases: Array.from({ length: 12 }, (_, index) =>
        purchase({ totalCostCents: 1000, date: `2026-09-${String(index + 10)}` }),
      ),
    });
    const lines = statementText(view, 'Ghaith', 'dirham', '2026-10-30').split('\n');
    expect(lines.filter((line) => line.includes(' · Balance '))).toHaveLength(10);
    // Two purchases came before the window: 20 dh owed, then ten more of 10 dh: 120 dh.
    expect(view.account.balanceCents).toBe(12_000);
    expect(lines).toContain('Balance before: 20 dh');
    expect(lines).toContain('Balance: 120 dh');
    expect(lines).toContain('We owe: 120 dh');
  });

  it('says nothing is owed, and shows an advance the supplier holds', () => {
    setLanguage('en', { persist: false });
    const settled = statementText(
      viewOf({
        purchases: [purchase({ totalCostCents: 1000, date: '2026-10-01' })],
        payments: [payment(1000, '2026-10-02')],
      }),
      'Ghaith',
      'dirham',
      '2026-10-30',
    );
    expect(settled).toContain('Nothing is owed.');
    expect(settled).not.toContain('Purchases still owed');

    const ahead = statementText(
      viewOf({
        purchases: [purchase({ totalCostCents: 1000, date: '2026-10-01' })],
        payments: [payment(1000, '2026-10-02'), payment(300, '2026-10-03')],
      }),
      'Ghaith',
      'dirham',
      '2026-10-30',
    );
    expect(ahead).toContain('Paid in advance:');
  });

  it('is written in Arabic when the language is', () => {
    setLanguage('ar', { persist: false });
    const text = statementText(
      viewOf({ purchases: [purchase({ totalCostCents: 1000, date: '2026-10-01' })] }),
      'غيث',
      'dirham',
      '2026-10-30',
    );
    expect(text).toContain('كشف حساب');
    expect(text).toMatch(/علينا: 10\s+د/);
    expect(text).toMatch(/الرصيد: 10\s+د/);
  });
});
