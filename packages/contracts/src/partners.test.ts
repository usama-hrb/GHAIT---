import { describe, expect, it } from 'vitest';
import {
  type CapitalMove,
  capitalMoveFields,
  cashFlowsOf,
  checkCapitalMove,
  checkCapitalMoveVoid,
  checkUnchanged,
  newCapitalMoveSchema,
  PARTNER_ISSUES,
  type PartnerDraw,
  partnerAccountOf,
} from './index.js';

const base = {
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  deviceId: 'desk',
  voidedAt: null,
};
const owner = crypto.randomUUID();
const partner = crypto.randomUUID();

const move = (
  partnerId: string,
  type: CapitalMove['type'],
  amountCents: number,
  note: string | null = null,
): CapitalMove => ({
  ...base,
  id: crypto.randomUUID(),
  partnerId,
  type,
  amountCents,
  date: '2026-10-01',
  note,
  settlementId: null,
});
const draw = (
  partnerId: string,
  amountCents: number,
  voidedAt: string | null = null,
): PartnerDraw => ({
  ...base,
  voidedAt,
  id: crypto.randomUUID(),
  partnerId,
  amountCents,
  date: '2026-10-05',
  reason: 'مصروف شخصي',
});

describe('partners (SPEC §6, §8.4)', () => {
  it('a withdrawal is negative and needs a reason; a contribution is positive', () => {
    const withdrawal = newCapitalMoveSchema.safeParse({
      partnerId: owner,
      kind: 'withdrawal',
      amountCents: 100,
      date: '2026-10-01',
    });
    expect(withdrawal.success).toBe(false);
    expect(
      capitalMoveFields(
        newCapitalMoveSchema.parse({
          partnerId: owner,
          kind: 'withdrawal',
          amountCents: 100,
          date: '2026-10-01',
          note: 'سفر',
        }),
      ),
    ).toMatchObject({ type: 'withdrawal', amountCents: -100, note: 'سفر' });
    expect(
      capitalMoveFields(
        newCapitalMoveSchema.parse({
          partnerId: owner,
          kind: 'contribution',
          amountCents: 100,
          date: '2026-10-01',
        }),
      ),
    ).toMatchObject({ type: 'contribution', amountCents: 100 });
  });

  it('the server takes contributions and withdrawals only, signed right, never edited', () => {
    expect(checkCapitalMove(move(owner, 'contribution', 5000))).toEqual([]);
    expect(checkCapitalMove(move(owner, 'withdrawal', -100, 'سفر'))).toEqual([]);
    const refused = [
      [move(owner, 'retained_profit', 100), PARTNER_ISSUES.retainedByHand],
      [move(owner, 'contribution', -5), PARTNER_ISSUES.wrongSign],
      [move(owner, 'withdrawal', 100, 'x'), PARTNER_ISSUES.wrongSign],
      [move(owner, 'withdrawal', -100), PARTNER_ISSUES.reasonRequired],
      [
        { ...move(owner, 'contribution', 100), settlementId: crypto.randomUUID() },
        PARTNER_ISSUES.retainedByHand,
      ],
    ] as const;
    for (const [record, message] of refused) {
      expect(checkCapitalMove(record)).toEqual([expect.objectContaining({ message })]);
    }
    const recorded = move(owner, 'contribution', 5000);
    expect(
      checkUnchanged(recorded, { ...recorded, updatedAt: '2026-10-02T00:00:00.000Z' }, [
        'amountCents',
        'type',
      ]),
    ).toEqual([]);
    expect(
      checkUnchanged(recorded, { ...recorded, amountCents: 6000 }, ['amountCents', 'type']),
    ).toEqual([expect.objectContaining({ path: ['amountCents'], message: PARTNER_ISSUES.fixed })]);
    // Retained profit goes only when its settlement is unlocked (PA3).
    expect(checkCapitalMoveVoid(recorded)).toEqual([]);
    expect(checkCapitalMoveVoid(move(owner, 'retained_profit', 100))).toEqual([
      expect.objectContaining({ message: PARTNER_ISSUES.retainedByHand }),
    ]);
  });

  it('each partner’s account, and the shop’s cash, from the records only', () => {
    const capitalMoves = [
      move(owner, 'contribution', 5_000_000),
      move(partner, 'contribution', 5_000_000),
      move(owner, 'withdrawal', -100_000, 'سفر'),
    ];
    const draws = [draw(partner, 20_000), draw(partner, 5000, '2026-10-06T00:00:00.000Z')];
    expect(partnerAccountOf(partner, { capitalMoves, draws })).toMatchObject({
      capitalCents: 5_000_000,
      drawsCents: 20_000,
      undrawnCents: -20_000,
    });
    expect(
      partnerAccountOf(owner, {
        capitalMoves,
        draws,
        shares: [{ partnerId: owner, amountCents: 7000 }],
      }),
    ).toMatchObject({
      capitalCents: 4_900_000,
      withdrawalsCents: 100_000,
      undrawnCents: 7000,
    });
    const flows = cashFlowsOf({
      payments: [
        {
          ...base,
          id: crypto.randomUUID(),
          customerId: null,
          kind: 'payment',
          amountCents: 9000,
          date: '2026-10-02',
          method: 'cash',
          note: null,
        },
        {
          ...base,
          id: crypto.randomUUID(),
          customerId: null,
          kind: 'refund',
          amountCents: 1000,
          date: '2026-10-03',
          method: 'cash',
          note: null,
        },
      ],
      purchases: [],
      expenses: [
        {
          ...base,
          id: crypto.randomUUID(),
          date: '2026-10-01',
          category: 'rent',
          amountCents: 300_000,
          paidDate: '2026-10-01',
          note: null,
          recurringExpenseId: null,
        },
        {
          ...base,
          id: crypto.randomUUID(),
          date: '2026-10-02',
          category: 'water',
          amountCents: 8000,
          paidDate: null,
          note: null,
          recurringExpenseId: null,
        },
      ],
      capitalMoves,
      draws,
    });
    expect(flows).toEqual({
      customerPaymentsCents: 9000,
      customerRefundsCents: 1000,
      contributionsCents: 10_000_000,
      capitalWithdrawalsCents: 100_000,
      purchasesPaidCents: 0,
      expensesPaidCents: 300_000,
      drawsCents: 20_000,
      cashAdjustmentsCents: 0,
    });
  });
});
