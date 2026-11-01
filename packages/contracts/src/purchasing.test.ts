import { describe, expect, it } from 'vitest';
import {
  buildPurchaseAggregate,
  checkPurchaseAggregate,
  type NewPurchase,
  newPurchaseSchema,
  PURCHASE_ISSUES,
  purchasePaymentIssues,
  type PurchaseAggregate,
  purchaseAggregateSchema,
  rollCode,
  rollCodeSchema,
} from './index.js';

const NOW = '2026-10-30T09:00:00.000Z';
const colors = Array.from({ length: 10 }, () => crypto.randomUUID());

function build(input: NewPurchase): PurchaseAggregate {
  const count = input.method === 'meter' ? input.rolls.length : 1;
  return buildPurchaseAggregate(
    input,
    {
      purchaseId: crypto.randomUUID(),
      rollIds: Array.from({ length: count }, () => crypto.randomUUID()),
      moveIds: Array.from({ length: count }, () => crypto.randomUUID()),
      shortCodes: Array.from({ length: count }, (_, index) => rollCode('A', index + 1)),
    },
    { deviceId: 'desk', now: NOW },
  );
}

const t1 = newPurchaseSchema.parse({
  method: 'meter',
  date: '2026-10-30',
  pricePerMeterCents: 1600,
  rolls: colors.map((variantId) => ({ variantId, lengthCm: 5000 })),
});

describe('buildPurchaseAggregate (SPEC §2.3)', () => {
  it('T1: an assortment of 10 colours × 50 m at 16 dh → 10 rolls of 800 dh', () => {
    const aggregate = build(t1);
    expect(aggregate.rolls).toHaveLength(10);
    expect(
      aggregate.rolls.every(
        (roll) => roll.lengthCmInitial === 5000 && roll.costTotalCents === 80_000,
      ),
    ).toBe(true);
    expect(aggregate.purchase).toMatchObject({
      method: 'meter',
      pricePerMeterCents: 1600,
      totalCostCents: 800_000,
      paidCents: 800_000,
      weightG: null,
    });
    expect(aggregate.rolls.map((roll) => roll.shortCode).slice(0, 2)).toEqual([
      'R-A0001',
      'R-A0002',
    ]);
    expect(aggregate.moves[0]).toMatchObject({
      type: 'purchase',
      deltaCm: 5000,
      rollId: aggregate.rolls[0]?.id,
      refId: aggregate.purchase.id,
      date: '2026-10-30',
    });
    expect(purchaseAggregateSchema.safeParse(aggregate).success).toBe(true);
    expect(checkPurchaseAggregate(aggregate)).toEqual([]);
  });

  it('T2: a ready piece of 2.3 m for 100 dh → one roll of 230 cm costing 10000', () => {
    const aggregate = build({
      method: 'piece',
      date: '2026-10-30',
      supplierId: null,
      notes: null,
      variantId: colors[0] ?? '',
      lengthCm: 230,
      totalCostCents: 10_000,
    });
    expect(aggregate.rolls).toEqual([
      expect.objectContaining({
        lengthCmInitial: 230,
        costTotalCents: 10_000,
        lengthEstimated: false,
      }),
    ]);
    expect(checkPurchaseAggregate(aggregate)).toEqual([]);
  });

  it('T4: 20 kg for 400 dh at 400 cm/kg → an estimated 8000 cm roll', () => {
    const aggregate = build({
      method: 'kg',
      date: '2026-10-30',
      supplierId: null,
      notes: null,
      variantId: colors[0] ?? '',
      weightG: 20_000,
      totalCostCents: 40_000,
      estCmPerKg: 400,
    });
    expect(aggregate.rolls[0]).toMatchObject({
      lengthCmInitial: 8000,
      costTotalCents: 40_000,
      lengthEstimated: true,
    });
    expect(aggregate.purchase).toMatchObject({
      weightG: 20_000,
      estCmPerKg: 400,
      pricePerMeterCents: null,
    });
    expect(checkPurchaseAggregate(aggregate)).toEqual([]);
  });

  it('needs one id and code per roll', () => {
    expect(() =>
      buildPurchaseAggregate(
        t1,
        { purchaseId: crypto.randomUUID(), rollIds: [], moveIds: [], shortCodes: [] },
        {
          deviceId: 'desk',
          now: NOW,
        },
      ),
    ).toThrow(/needs 10 ids/);
  });
});

describe('checkPurchaseAggregate: the server re-checks with core', () => {
  const tampered = (change: (aggregate: PurchaseAggregate) => void) => {
    const aggregate = structuredClone(build(t1));
    change(aggregate);
    return checkPurchaseAggregate(aggregate);
  };

  it.each([
    [
      'a roll cheaper than core says',
      (a: PurchaseAggregate) => {
        if (a.rolls[0]) a.rolls[0].costTotalCents = 1;
      },
      ['rolls', 0, 'costTotalCents'],
    ],
    [
      'a total that is not the sum',
      (a: PurchaseAggregate) => {
        a.purchase.totalCostCents += 5;
      },
      ['purchase', 'totalCostCents'],
    ],
    [
      'a move that adds extra length',
      (a: PurchaseAggregate) => {
        if (a.moves[1]) a.moves[1].deltaCm = 6000;
      },
      ['moves', 1, 'deltaCm'],
    ],
    [
      'a roll that is not active',
      (a: PurchaseAggregate) => {
        if (a.rolls[2]) a.rolls[2].status = 'empty';
      },
      ['rolls', 2, 'status'],
    ],
    [
      'a move of another purchase',
      (a: PurchaseAggregate) => {
        if (a.moves[0]) a.moves[0].refId = crypto.randomUUID();
      },
      ['moves', 0, 'refId'],
    ],
  ])('rejects %s', (_label, change, path) => {
    expect(tampered(change)).toEqual([{ path, message: PURCHASE_ISSUES.notCore, code: 'custom' }]);
  });

  it('SP1: a purchase may be part paid when a supplier is owed the rest', () => {
    const owing = (paidCents: number, supplierId: string | null) =>
      build({ ...t1, supplierId, paidCents });
    const supplier = crypto.randomUUID();
    const part = owing(40_000, supplier);
    expect(part.purchase).toMatchObject({ totalCostCents: 800_000, paidCents: 40_000 });
    expect(checkPurchaseAggregate(part)).toEqual([]);
    expect(checkPurchaseAggregate(owing(0, supplier))).toEqual([]);
  });

  it('SP1: a debt needs a supplier, and nothing is paid beyond the total', () => {
    const noSupplier = build({ ...t1, supplierId: null, paidCents: 100 });
    expect(checkPurchaseAggregate(noSupplier)).toEqual([
      { path: ['supplierId'], message: PURCHASE_ISSUES.debtNeedsSupplier, code: 'custom' },
    ]);
    const tooMuch = build({ ...t1, supplierId: crypto.randomUUID(), paidCents: 900_000 });
    expect(checkPurchaseAggregate(tooMuch)).toEqual([
      { path: ['paidCents'], message: PURCHASE_ISSUES.paidAboveTotal, code: 'custom' },
    ]);
    expect(
      purchasePaymentIssues({ totalCostCents: 100, paidCents: 100, supplierId: null }),
    ).toEqual([]);
  });

  it('rejects records that cannot be a purchase', () => {
    expect(
      tampered((a) => {
        a.purchase.pricePerMeterCents = null;
      }),
    ).toEqual([expect.objectContaining({ message: PURCHASE_ISSUES.inconsistent })]);
    expect(
      tampered((a) => {
        a.moves.pop();
      }),
    ).toEqual([expect.objectContaining({ message: PURCHASE_ISSUES.inconsistent })]);
    expect(
      tampered((a) => {
        if (a.rolls[1]) a.rolls[1].shortCode = 'R-A0001';
      }),
    ).toEqual([
      expect.objectContaining({ path: ['rolls'], message: PURCHASE_ISSUES.inconsistent }),
    ]);
    expect(
      tampered((a) => {
        a.purchase.method = 'piece';
      }),
    ).toEqual([expect.objectContaining({ message: PURCHASE_ISSUES.inconsistent })]);
  });
});

describe('roll codes', () => {
  it('device code + 4-digit counter', () => {
    expect(rollCode('A', 1)).toBe('R-A0001');
    expect(rollCode('AB', 12_345)).toBe('R-AB12345');
    expect(rollCodeSchema.safeParse('R-0123').success).toBe(false);
    expect(rollCodeSchema.safeParse('R-A0123').success).toBe(true);
  });
});
