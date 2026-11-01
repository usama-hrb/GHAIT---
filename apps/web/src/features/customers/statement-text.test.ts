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
    collectibleCents: 0,
    writtenOffCents: 0,
    creditCents: 0,
    overdueCents: 0,
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
