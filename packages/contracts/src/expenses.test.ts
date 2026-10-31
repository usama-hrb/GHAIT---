import { describe, expect, it } from 'vitest';
import {
  expenseInputSchema,
  expenseItemOf,
  expenseSchema,
  parseSettingValue,
  recurringExpenseInputSchema,
  recurringTemplateOf,
  SETTINGS,
} from './index.js';

const base = {
  id: crypto.randomUUID(),
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  deviceId: 'desk',
  voidedAt: null,
};

describe('expenses (SPEC §5)', () => {
  it('an expense is unpaid unless it has a paid date; amounts are whole cents above 0', () => {
    expect(
      expenseInputSchema.parse({ date: '2026-10-05', category: 'rent', amountCents: 300_000 }),
    ).toEqual({
      date: '2026-10-05',
      category: 'rent',
      amountCents: 300_000,
      paidDate: null,
      note: null,
      recurringExpenseId: null,
    });
    expect(
      expenseInputSchema.safeParse({ date: '2026-10-05', category: 'rent', amountCents: 0 })
        .success,
    ).toBe(false);
    expect(
      expenseInputSchema.safeParse({ date: '2026-10-05', category: 'Rent!', amountCents: 1 })
        .success,
    ).toBe(false);
  });

  it('maps records to the core rules', () => {
    const expense = expenseSchema.parse({
      ...base,
      voidedAt: '2026-10-02T09:00:00.000Z',
      date: '2026-10-05',
      category: 'electricity',
      amountCents: 45_000,
      paidDate: '2026-10-06',
      recurringExpenseId: base.id,
    });
    expect(expenseItemOf(expense)).toEqual({
      date: '2026-10-05',
      category: 'electricity',
      amountCents: 45_000,
      paidDate: '2026-10-06',
      voided: true,
      recurringId: base.id,
    });
    const template = {
      ...base,
      ...recurringExpenseInputSchema.parse({
        name: 'كهرباء',
        category: 'electricity',
        dayOfMonth: 15,
      }),
    };
    expect(template).toMatchObject({ amountCents: null, active: true });
    expect(recurringTemplateOf(template, '2026-10-01')).toEqual({
      id: base.id,
      dayOfMonth: 15,
      active: true,
      since: '2026-10-01',
    });
    expect(
      recurringTemplateOf({ ...template, voidedAt: base.createdAt }, '2026-10-01').active,
    ).toBe(false);
    expect(
      recurringExpenseInputSchema.safeParse({ name: 'x', category: 'rent', dayOfMonth: 32 })
        .success,
    ).toBe(false);
  });

  it('the default categories and reminder days are valid settings', () => {
    expect(
      parseSettingValue('expense_categories', SETTINGS.expense_categories.default),
    ).toHaveLength(8);
    expect(parseSettingValue('expense_reminder_days', SETTINGS.expense_reminder_days.default)).toBe(
      3,
    );
  });
});
