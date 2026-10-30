import { describe, expect, it } from 'vitest';
import {
  buildSaleAggregate,
  buildSaleVoid,
  checkSaleAggregate,
  checkSaleVoid,
  type NewSaleInput,
  newSaleSchema,
  priceSale,
  type Roll,
  type RollHistory,
  rollLedgerOf,
  SALE_ISSUES,
  type SaleAggregate,
  saleFigures,
  shopDate,
  type StockMove,
} from './index.js';

const NOW = '2026-10-30T10:00:00.000Z';
const DAY = '2026-10-30';
const base = { createdAt: NOW, updatedAt: NOW, deviceId: 'desk', voidedAt: null };

function rollOf(lengthCm: number, costTotalCents: number, lengthEstimated = false): RollHistory {
  const roll: Roll = {
    ...base,
    createdAt: '2026-10-01T09:00:00.000Z',
    id: crypto.randomUUID(),
    shortCode: 'R-A0001',
    variantId: crypto.randomUUID(),
    purchaseId: crypto.randomUUID(),
    lengthCmInitial: lengthCm,
    costTotalCents,
    lengthEstimated,
    status: 'active',
  };
  const purchase: StockMove = {
    ...base,
    createdAt: roll.createdAt,
    id: crypto.randomUUID(),
    rollId: roll.id,
    type: 'purchase',
    deltaCm: lengthCm,
    refId: roll.purchaseId,
    date: '2026-10-01',
    note: null,
  };
  return { roll, moves: [purchase] };
}

const historiesOf = (...rolls: RollHistory[]) => new Map(rolls.map((h) => [h.roll.id, h]));

const line = (history: RollHistory, soldCm: number, perMeterCents: number) => ({
  rollId: history.roll.id,
  soldCm,
  price: { perMeterCents },
  refPricePerMeterCents: 2000,
  minPricePerMeterCents: 1700,
});

function idsFor(lines: number) {
  return {
    saleId: crypto.randomUUID(),
    lineIds: Array.from({ length: lines }, () => crypto.randomUUID()),
    moveIds: Array.from({ length: lines }, () => crypto.randomUUID()),
    paymentId: crypto.randomUUID(),
    allocationId: crypto.randomUUID(),
  };
}

function build(input: NewSaleInput, histories: Map<string, RollHistory>) {
  return buildSaleAggregate(newSaleSchema.parse(input), histories, idsFor(input.lines.length), {
    deviceId: 'desk',
    now: NOW,
  });
}

function aggregateOf(input: NewSaleInput, histories: Map<string, RollHistory>): SaleAggregate {
  const built = build(input, histories);
  if (!built.ok) throw new Error(JSON.stringify(built.issues));
  return built.aggregate;
}

/** T1's roll: 50 m that cost 800 dh (16 dh/m). */
const rosa = () => rollOf(5000, 80_000);

describe('sales (SPEC §3, §4)', () => {
  it('T5: 1 m at 18 dh on a 16 dh/m roll (reference 20): capital 1600, profit 200, paid in cash', () => {
    const roll = rosa();
    const built = build(
      { date: DAY, lines: [line(roll, 100, 1800)], paidCents: 1800 },
      historiesOf(roll),
    );
    if (!built.ok) throw new Error('expected a sale');
    expect(built.priced.lines[0]).toMatchObject({
      lineTotalCents: 1800,
      lineCostCents: 1600,
      profitCents: 200,
      warnings: [],
    });
    const { sale, lines, moves, payment, allocation } = built.aggregate;
    expect(sale).toMatchObject({ totalCents: 1800, discountCents: 0, customerId: null });
    expect(lines[0]).toMatchObject({ refPricePerMeterCents: 2000, actualPricePerMeterCents: 1800 });
    expect(moves[0]).toMatchObject({ type: 'sale', deltaCm: -100, refId: lines[0]?.id });
    expect(payment).toMatchObject({ kind: 'payment', amountCents: 1800, method: 'cash' });
    expect(allocation).toMatchObject({
      paymentId: payment?.id,
      saleId: sale.id,
      amountCents: 1800,
    });
    expect(checkSaleAggregate(built.aggregate, historiesOf(roll))).toEqual([]);
  });

  it('T11: at 14 dh on a 16 dh/m roll the sale needs an explicit confirmation; 2 dh/m is a loss', () => {
    const roll = rosa();
    const input = { date: DAY, lines: [line(roll, 100, 1400)], paidCents: 1400 };
    expect(build(input, historiesOf(roll))).toEqual({
      ok: false,
      issues: [expect.objectContaining({ message: SALE_ISSUES.belowCostUnconfirmed })],
    });
    const priced = priceSale(newSaleSchema.parse(input), historiesOf(roll));
    expect(priced.lines[0]?.warnings).toEqual(['below_min_price', 'below_cost']);
    expect(priced).toMatchObject({ requiresConfirmation: true, split: { lossCents: 200 } });

    const confirmed = aggregateOf({ ...input, confirmedBelowCost: true }, historiesOf(roll));
    expect(checkSaleAggregate(confirmed, historiesOf(roll))).toEqual([]);
    // The server refuses one that was not confirmed, whatever the device sent.
    const unconfirmed = { ...confirmed, sale: { ...confirmed.sale, confirmedBelowCost: false } };
    expect(checkSaleAggregate(unconfirmed, historiesOf(roll))).toEqual([
      expect.objectContaining({ message: SALE_ISSUES.belowCostUnconfirmed }),
    ]);
  });

  it('a discount that takes the invoice under cost needs the confirmation too (P2)', () => {
    const roll = rosa();
    const input = {
      date: DAY,
      lines: [line(roll, 100, 1800)],
      discountCents: 300,
      paidCents: 1500,
    };
    expect(priceSale(newSaleSchema.parse(input), historiesOf(roll))).toMatchObject({
      requiresConfirmation: true,
      split: { totalCents: 1500, lossCents: 100 },
    });
    expect(
      priceSale(newSaleSchema.parse({ ...input, discountCents: 2000 }), historiesOf(roll)).issues,
    ).toEqual([expect.objectContaining({ message: SALE_ISSUES.discountAboveTotal })]);
  });

  it('costs each line after the earlier ones on the same roll (T3 across one invoice)', () => {
    const piece = rollOf(230, 10_000);
    const priced = priceSale(
      newSaleSchema.parse({
        date: DAY,
        lines: [line(piece, 100, 5000), line(piece, 100, 5000), line(piece, 30, 5000)],
        paidCents: 11_500,
      }),
      historiesOf(piece),
    );
    expect(priced.lines.map((l) => l.lineCostCents)).toEqual([4348, 4348, 1304]);
    expect(priced.lines.at(-1)?.costing.exhaustsRoll).toBe(true);
  });

  it('a sale split across two rolls is one line and one move per roll', () => {
    const [first, second] = [rollOf(300, 4800), rollOf(5000, 80_000)];
    const aggregate = aggregateOf(
      {
        date: DAY,
        lines: [line(first, 300, 1800), line(second, 200, 1800)],
        paidCents: 9000,
      },
      historiesOf(first, second),
    );
    expect(aggregate.lines.map((l) => [l.rollId, l.soldCm, l.lineTotalCents])).toEqual([
      [first.roll.id, 300, 5400],
      [second.roll.id, 200, 3600],
    ]);
    expect(aggregate.moves.map((m) => m.deltaCm)).toEqual([-300, -200]);
    expect(aggregate.sale.totalCents).toBe(9000);
  });

  it('credit: the rest needs a customer; a due date only on credit, not before the sale', () => {
    const roll = rosa();
    const customerId = crypto.randomUUID();
    const sale = { date: DAY, lines: [line(roll, 100, 1800)] };
    const issuesOf = (input: Partial<NewSaleInput>) =>
      priceSale(
        newSaleSchema.parse({ ...sale, paidCents: 0, ...input }),
        historiesOf(roll),
      ).issues.map((i) => i.message);
    expect(issuesOf({ paidCents: 500 })).toEqual([SALE_ISSUES.creditNeedsCustomer]);
    expect(issuesOf({ paidCents: 1900 })).toEqual([SALE_ISSUES.paidAboveTotal]);
    expect(issuesOf({ paidCents: 1800, dueDate: '2026-11-30' })).toEqual([
      SALE_ISSUES.dueDateWithoutCredit,
    ]);
    expect(issuesOf({ customerId, dueDate: '2026-10-01' })).toEqual([
      SALE_ISSUES.dueDateBeforeSale,
    ]);
    const credit = aggregateOf(
      { ...sale, customerId, paidCents: 0, dueDate: '2026-11-30' },
      historiesOf(roll),
    );
    expect(credit).toMatchObject({
      payment: null,
      allocation: null,
      sale: { dueDate: '2026-11-30' },
    });
    const deposit = aggregateOf({ ...sale, customerId, paidCents: 500 }, historiesOf(roll));
    expect(deposit.payment).toMatchObject({ customerId, amountCents: 500 });
    expect(checkSaleAggregate(deposit, historiesOf(roll))).toEqual([]);
  });

  it('sells an untouched ready piece whole at its piece price (P5)', () => {
    const piece = rollOf(230, 10_000);
    const whole = {
      date: DAY,
      lines: [{ ...line(piece, 230, 0), price: { wholePieceCents: 12_000 } }],
      paidCents: 12_000,
    };
    const aggregate = aggregateOf(whole, historiesOf(piece));
    expect(aggregate.lines[0]).toMatchObject({
      wholePiece: true,
      lineTotalCents: 12_000,
      actualPricePerMeterCents: 5217,
    });
    expect(checkSaleAggregate(aggregate, historiesOf(piece))).toEqual([]);
    const cut: RollHistory = {
      ...piece,
      moves: [
        ...piece.moves,
        {
          ...piece.moves[0],
          id: crypto.randomUUID(),
          type: 'loss',
          deltaCm: -10,
          note: 'x',
        } as StockMove,
      ],
    };
    expect(priceSale(newSaleSchema.parse(whole), historiesOf(cut)).issues).toEqual([
      expect.objectContaining({ message: SALE_ISSUES.wholePieceTouched }),
    ]);
  });

  it('the server refuses records that do not match what was typed, or an unknown roll', () => {
    const roll = rosa();
    const histories = historiesOf(roll);
    const aggregate = aggregateOf(
      { date: DAY, lines: [line(roll, 100, 1800)], paidCents: 1800 },
      histories,
    );
    const [firstLine] = aggregate.lines;
    const [firstMove] = aggregate.moves;
    if (!firstLine || !firstMove || !aggregate.payment) throw new Error('expected records');
    const tampered: SaleAggregate[] = [
      { ...aggregate, sale: { ...aggregate.sale, totalCents: 1700 } },
      { ...aggregate, lines: [{ ...firstLine, lineTotalCents: 1700 }] },
      { ...aggregate, moves: [{ ...firstMove, deltaCm: -90 }] },
      { ...aggregate, allocation: null },
      { ...aggregate, payment: { ...aggregate.payment, method: 'bank' } },
    ];
    for (const sale of tampered) {
      expect(checkSaleAggregate(sale, histories)).toEqual([
        expect.objectContaining({ message: SALE_ISSUES.notCore }),
      ]);
    }
    expect(checkSaleAggregate({ ...aggregate, moves: [] }, histories)).toEqual([
      expect.objectContaining({ message: SALE_ISSUES.inconsistent }),
    ]);
    expect(checkSaleAggregate(aggregate, new Map())).toEqual([
      expect.objectContaining({ message: SALE_ISSUES.unknownRoll }),
    ]);
    expect(() =>
      buildSaleAggregate(
        newSaleSchema.parse({ date: DAY, lines: [line(roll, 100, 1800)], paidCents: 1800 }),
        histories,
        { ...idsFor(1), paymentId: null },
        { deviceId: 'desk', now: NOW },
      ),
    ).toThrow(RangeError);
  });
});

describe('voiding a sale (P13)', () => {
  it('puts the cloth back as if the lines had never been sold, and refunds what was paid', () => {
    const [first, second] = [rollOf(300, 4800), rollOf(5000, 80_000)];
    const histories = historiesOf(first, second);
    const customerId = crypto.randomUUID();
    const aggregate = aggregateOf(
      {
        date: DAY,
        customerId,
        lines: [line(first, 300, 1800), line(second, 200, 1800)],
        paidCents: 4000,
      },
      histories,
    );
    const records = {
      sale: aggregate.sale,
      moves: aggregate.moves,
      allocations: aggregate.allocation ? [aggregate.allocation] : [],
    };
    const sorted = [...aggregate.moves].sort((a, b) => a.id.localeCompare(b.id));
    const voided = buildSaleVoid(
      { reason: 'خطأ في الإدخال', date: DAY },
      records,
      {
        voidId: crypto.randomUUID(),
        reversalIds: sorted.map(() => crypto.randomUUID()),
        refundId: crypto.randomUUID(),
      },
      { deviceId: 'desk', now: '2026-10-30T11:00:00.000Z' },
    );
    expect(voided.refund).toMatchObject({ kind: 'refund', customerId, amountCents: 4000 });
    expect(voided.saleVoid).toMatchObject({
      saleId: aggregate.sale.id,
      refundId: voided.refund?.id,
    });
    expect(voided.reversals.map((m) => [m.type, m.refId, m.deltaCm])).toEqual(
      sorted.map((m) => ['reversal', m.id, -m.deltaCm]),
    );
    const after = rollLedgerOf(first.roll, [
      ...first.moves,
      ...aggregate.moves.filter((m) => m.rollId === first.roll.id),
      ...voided.reversals.filter((m) => m.rollId === first.roll.id),
    ]);
    expect(after).toMatchObject({ remainingCm: 300, costs: [], unallocatedCostCents: 4800 });

    expect(checkSaleVoid(voided, records)).toEqual([]);
    expect(
      checkSaleVoid(
        { ...voided, refund: null, saleVoid: { ...voided.saleVoid, refundId: null } },
        records,
      ),
    ).toEqual([expect.objectContaining({ message: SALE_ISSUES.inconsistent })]);
    expect(checkSaleVoid(voided, { ...records, sale: { ...records.sale, voidedAt: NOW } })).toEqual(
      [expect.objectContaining({ message: SALE_ISSUES.alreadyVoided })],
    );
    expect(() =>
      buildSaleVoid(
        { reason: 'x', date: DAY },
        records,
        { voidId: crypto.randomUUID(), reversalIds: [], refundId: null },
        {
          deviceId: 'desk',
          now: NOW,
        },
      ),
    ).toThrow(RangeError);
  });

  it('a credit sale with nothing paid has nothing to refund', () => {
    const roll = rosa();
    const aggregate = aggregateOf(
      { date: DAY, customerId: crypto.randomUUID(), lines: [line(roll, 100, 1800)], paidCents: 0 },
      historiesOf(roll),
    );
    const voided = buildSaleVoid(
      { reason: 'ألغى الزبون', date: DAY },
      { sale: aggregate.sale, moves: aggregate.moves, allocations: [] },
      { voidId: crypto.randomUUID(), reversalIds: [crypto.randomUUID()], refundId: null },
      { deviceId: 'desk', now: NOW },
    );
    expect(voided).toMatchObject({ refund: null, saleVoid: { refundId: null } });
  });
});

describe('saleFigures (P9, P10)', () => {
  it('T8: 200 dh costing 160 on credit, paid 100 then 100 → capital 100 / 0, then 60 / 40', () => {
    const roll = rosa();
    const aggregate = aggregateOf(
      { date: DAY, customerId: crypto.randomUUID(), lines: [line(roll, 1000, 2000)], paidCents: 0 },
      historiesOf(roll),
    );
    const ledger = rollLedgerOf(roll.roll, [...roll.moves, ...aggregate.moves]);
    const allocation = (amountCents: number, at: string) => ({
      ...base,
      createdAt: at,
      updatedAt: at,
      id: crypto.randomUUID(),
      paymentId: crypto.randomUUID(),
      saleId: aggregate.sale.id,
      amountCents,
      date: DAY,
    });
    const figures = saleFigures(
      aggregate.sale,
      aggregate.lines,
      aggregate.moves,
      new Map([[roll.roll.id, ledger]]),
      // Given out of order: the parts follow the order the payments were made.
      [
        allocation(10_000, '2026-10-30T12:00:00.000Z'),
        allocation(10_000, '2026-10-30T11:00:00.000Z'),
      ],
    );
    expect(figures).toMatchObject({ totalCents: 20_000, capitalCents: 16_000, dueCents: 0 });
    expect(figures.payments.map((p) => [p.amountCents, p.capitalCents, p.profitCents])).toEqual([
      [10_000, 10_000, 0],
      [10_000, 6000, 4000],
    ]);
  });

  it('derives each line’s cost from its roll, and what was paid and is still due', () => {
    const roll = rollOf(8000, 40_000, true);
    const aggregate = aggregateOf(
      {
        date: DAY,
        customerId: crypto.randomUUID(),
        lines: [line(roll, 100, 1800)],
        paidCents: 500,
      },
      historiesOf(roll),
    );
    const ledger = rollLedgerOf(roll.roll, [...roll.moves, ...aggregate.moves]);
    const allocations = aggregate.allocation ? [aggregate.allocation] : [];
    const figures = saleFigures(
      aggregate.sale,
      aggregate.lines,
      aggregate.moves,
      new Map([[roll.roll.id, ledger]]),
      allocations,
    );
    expect(figures).toMatchObject({
      lines: [{ costCents: 500, profitCents: 1300, provisional: true }],
      totalCents: 1800,
      capitalCents: 500,
      profitCents: 1300,
      paidCents: 500,
      dueCents: 1300,
    });
    const voided = saleFigures(
      { ...aggregate.sale, voidedAt: NOW },
      aggregate.lines,
      aggregate.moves,
      new Map([[roll.roll.id, ledger]]),
      allocations,
    );
    expect(voided).toMatchObject({
      lines: [{ costCents: null, profitCents: null }],
      capitalCents: null,
      dueCents: 0,
    });
  });
});

describe('shopDate', () => {
  it('is the calendar day in Casablanca (UTC+1 in June), whatever the device zone', () => {
    expect(shopDate(new Date('2026-06-15T23:30:00.000Z'))).toBe('2026-06-16');
    expect(shopDate(new Date('2026-06-15T22:30:00.000Z'))).toBe('2026-06-15');
  });
});
