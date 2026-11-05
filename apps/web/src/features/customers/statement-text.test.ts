import type { CustomerAccount } from '@fabric/core';
import { describe, expect, it } from 'vitest';
import { setLanguage } from '@/i18n';
import type { CustomerAccountView } from '@/local-db';
import { statementText } from './statement-text';

const base = { createdAt: '', updatedAt: '', deviceId: 'desk', voidedAt: null, serverSeq: null };

const view = (account: Partial<CustomerAccount>): CustomerAccountView => ({
  customer: { ...base, id: 'c', name: 'فاطمة', phone: null, notes: null },
  account: {
    balanceCents: 0,
    purchasesCents: 0,
    receivedCents: 0,
    refundedCents: 0,
    collectibleCents: 0,
    writtenOffCents: 0,
    creditCents: 0,
    overdueCents: 0,
    invoices: [],
    openInvoices: [],
    oldestOpenDate: null,
    ...account,
  },
  sales: [],
  payments: [],
  allocations: [],
  writeOffs: [],
  returns: [],
});

describe('statementText', () => {
  it('lists what is still to collect, leaving written-off debts out', () => {
    const text = statementText(
      view({
        collectibleCents: 3000,
        openInvoices: [
          {
            saleId: 'a',
            date: '2026-10-01',
            dueDate: '2026-11-01',
            totalCents: 4000,
            returnedCents: 0,
            paidCents: 1000,
            dueCents: 3000,
            writtenOff: false,
            overdue: false,
          },
          {
            saleId: 'b',
            date: '2026-08-01',
            dueDate: null,
            totalCents: 500,
            returnedCents: 0,
            paidCents: 0,
            dueCents: 500,
            writtenOff: true,
            overdue: false,
          },
        ],
      }),
      'غيث',
      'rial',
      '2026-10-30',
    );
    expect(text.split('\n')).toEqual([
      'غيث',
      'كشف حساب · فاطمة · 30 أكتوبر 2026',
      '',
      '• فاتورة 1 أكتوبر 2026: الإجمالي 800 ريال · المدفوع 200 ريال · الباقي 600 ريال · يُستحق في 1 نونبر 2026',
      '',
      'المجموع المستحق: 600 ريال',
      '',
      'شكراً لتعاملكم معنا',
    ]);
  });

  it('lists the latest payments received (five, newest first), not the refunds', () => {
    const paid = (id: string, date: string, amountCents: number, kind: 'payment' | 'refund') => ({
      ...base,
      id,
      customerId: 'c',
      kind,
      amountCents,
      date,
      method: 'cash' as const,
      note: null,
    });
    const filled = view({ collectibleCents: 600 });
    filled.payments = [
      paid('p7', '2026-10-20', 700, 'payment'),
      paid('r', '2026-10-19', 100, 'refund'),
      paid('p6', '2026-10-18', 600, 'payment'),
      paid('p5', '2026-10-17', 500, 'payment'),
      paid('p4', '2026-10-16', 400, 'payment'),
      paid('p3', '2026-10-15', 300, 'payment'),
      paid('p2', '2026-10-14', 200, 'payment'),
      paid('p1', '2026-10-13', 100, 'payment'),
    ];
    setLanguage('ar', { persist: false });
    const lines = statementText(filled, 'غيث', 'dirham', '2026-10-30').split('\n');
    const from = lines.indexOf('مدفوعاتكم:');
    expect(from).toBeGreaterThan(0);
    expect(lines.slice(from + 1, from + 6)).toEqual([
      '• 20 أكتوبر 2026: 7 د',
      '• 18 أكتوبر 2026: 6 د',
      '• 17 أكتوبر 2026: 5 د',
      '• 16 أكتوبر 2026: 4 د',
      '• 15 أكتوبر 2026: 3 د',
    ]);
    expect(lines[from + 6]).toBe('');
  });

  it('says nothing is owed, and shows a credit the shop holds', () => {
    const text = statementText(view({ creditCents: 500 }), 'غيث', 'dirham', '2026-10-30');
    expect(text).toContain('لا شيء مستحق عليكم.');
    expect(text).toContain('رصيدكم لدينا: 5 د');
  });
});

describe('statementText in English', () => {
  it('lists what is still to collect, in English', () => {
    setLanguage('en', { persist: false });
    const text = statementText(
      view({
        collectibleCents: 3000,
        openInvoices: [
          {
            saleId: 'a',
            date: '2026-10-01',
            dueDate: '2026-11-01',
            totalCents: 4000,
            returnedCents: 0,
            paidCents: 1000,
            dueCents: 3000,
            writtenOff: false,
            overdue: false,
          },
        ],
      }),
      'Ghaith',
      'rial',
      '2026-10-30',
    );
    expect(text.split('\n')).toEqual([
      'Ghaith',
      'Account statement · فاطمة · 30 October 2026',
      '',
      '• Invoice 1 October 2026: Total 800\u00A0rial · Paid 200\u00A0rial · Remaining 600\u00A0rial · Due on 1 November 2026',
      '',
      'Total owed: 600\u00A0rial',
      '',
      'Thank you for your business',
    ]);
  });

  it('says nothing is due, and shows a credit the shop holds', () => {
    setLanguage('en', { persist: false });
    const text = statementText(view({ creditCents: 500 }), 'Ghaith', 'dirham', '2026-10-30');
    expect(text).toContain('Nothing is due from you.');
    expect(text).toContain('Your credit with us: 5\u00A0dh');
  });
});
