import { describe, expect, it } from 'vitest';
import { setLanguage } from '@/i18n';
import type { SaleView } from '@/local-db';
import { invoiceText } from './invoice-text';

const base = { createdAt: '', updatedAt: '', deviceId: 'desk', voidedAt: null, serverSeq: null };

function view(
  overrides: Partial<SaleView['figures']> = {},
  dueDate: string | null = null,
): SaleView {
  return {
    sale: {
      ...base,
      id: 's',
      date: '2026-10-30',
      customerId: 'c',
      totalCents: 5000,
      discountCents: 0,
      dueDate,
      confirmedBelowCost: false,
      note: null,
    },
    customer: { ...base, id: 'c', name: 'فاطمة', phone: '0612345678', notes: null },
    lines: [
      {
        line: {
          ...base,
          id: 'l',
          saleId: 's',
          rollId: 'r',
          soldCm: 250,
          refPricePerMeterCents: 2000,
          minPricePerMeterCents: 1700,
          actualPricePerMeterCents: 2000,
          wholePiece: false,
          lineTotalCents: 5000,
        },
        roll: undefined,
        variant: { ...base, id: 'v', fabricId: 'f', colorName: 'أحمر', lowStockThresholdCm: 0 },
        fabric: undefined,
        figures: undefined,
      },
    ],
    figures: {
      lines: [],
      linesTotalCents: 5000,
      discountCents: 0,
      totalCents: 5000,
      returnedCents: 0,
      netTotalCents: 5000,
      capitalCents: 4000,
      profitCents: 1000,
      paidCents: 1000,
      dueCents: 4000,
      payments: [],
      ...overrides,
    },
    saleVoid: undefined,
    writeOff: undefined,
    returns: [],
  };
}

describe('invoiceText (SPEC §4)', () => {
  it('lists the shop, date, customer, lines and what is left, in the display unit', () => {
    const text = invoiceText(view({}, '2026-11-30'), 'غيث', 'rial');
    expect(text.split('\n')).toEqual([
      'غيث',
      'فاتورة · 30 أكتوبر 2026',
      'الزبون: فاطمة',
      '',
      '• أحمر: 2.5 م × 400 ريال = 1,000 ريال',
      '',
      'الإجمالي: 1,000 ريال',
      'المدفوع: 200 ريال',
      'الباقي: 800 ريال',
      'يُستحق في 30 نونبر 2026',
      '',
      'شكراً لتعاملكم معنا',
    ]);
  });

  it('shows the discount, and nothing left once paid; amounts in dirham on request', () => {
    const text = invoiceText(
      view({
        linesTotalCents: 5000,
        discountCents: 500,
        totalCents: 4500,
        paidCents: 4500,
        dueCents: 0,
      }),
      'غيث',
      'dirham',
    );
    expect(text).toContain('المجموع: 50 د');
    expect(text).toContain('الخصم: 5 د');
    expect(text).toContain('الباقي: 0 د');
    expect(text).not.toContain('يُستحق');
  });
});

describe('invoiceText in English', () => {
  it('writes the invoice, its units and its dates in English', () => {
    setLanguage('en', { persist: false });
    const text = invoiceText(view({}, '2026-11-30'), 'Ghaith', 'rial');
    expect(text.split('\n')).toEqual([
      'Ghaith',
      'Invoice · 30 October 2026',
      'Customer: فاطمة',
      '',
      '• أحمر: 2.5\u00A0m × 400\u00A0rial = 1,000\u00A0rial',
      '',
      'Total: 1,000\u00A0rial',
      'Paid: 200\u00A0rial',
      'Remaining: 800\u00A0rial',
      'Due on 30 November 2026',
      '',
      'Thank you for your business',
    ]);
  });

  it('shows the amounts in dirham on request', () => {
    setLanguage('en', { persist: false });
    const text = invoiceText(view({}), 'Ghaith', 'dirham');
    expect(text).toContain('Total: 50\u00A0dh');
    expect(text).toContain('Remaining: 40\u00A0dh');
  });
});
