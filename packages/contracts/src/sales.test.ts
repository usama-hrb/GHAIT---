import { describe, expect, it } from 'vitest';
import {
  type BatchHistory,
  batchLedgerOf,
  buildSaleAggregate,
  buildSaleVoid,
  checkSaleAggregate,
  checkSaleMinimums,
  checkSaleVoid,
  type NewSaleInput,
  newSaleSchema,
  type ProductBatch,
  type ProductStockMove,
  priceSale,
  SALE_ISSUES,
  type SaleAggregate,
  saleFigures,
  shopDate,
} from './index.js';

const NOW = '2026-10-30T10:00:00.000Z';
const DAY = '2026-10-30';
const base = { createdAt: NOW, updatedAt: NOW, deviceId: 'desk', voidedAt: null };
const BOUGHT = '2026-10-01T09:00:00.000Z';

interface BatchOptions {
  /** Bought by weight (10 kg) and converted at the length given, until it is measured. */
  estimated?: boolean;
  /** Bought by weight with no length known yet. */
  awaiting?: boolean;
  /** Bought in pieces: the quantity is the number of pieces. */
  pieces?: boolean;
}

/** A batch with its receipt: `quantity` cm (or pieces), costing `costTotalCents`. */
function batchOf(
  quantity: number,
  costTotalCents: number,
  options: BatchOptions = {},
): BatchHistory {
  const unit = options.pieces ? 'piece' : options.estimated || options.awaiting ? 'kg' : 'meter';
  const received = unit === 'kg' ? 10_000 : quantity;
  const batch: ProductBatch = {
    ...base,
    createdAt: BOUGHT,
    id: crypto.randomUUID(),
    code: 'B-A0001',
    productId: crypto.randomUUID(),
    purchaseId: crypto.randomUUID(),
    purchaseDate: '2026-10-01',
    unit,
    receivedQuantity: received,
    costTotalCents,
    conversion: options.estimated
      ? { weightG: 10_000, lengthCm: quantity, source: 'estimated' }
      : null,
    status: 'active',
  };
  const receipt: ProductStockMove = {
    ...base,
    createdAt: BOUGHT,
    id: crypto.randomUUID(),
    batchId: batch.id,
    type: 'purchase',
    unit,
    delta: received,
    refId: batch.purchaseId,
    date: '2026-10-01',
    note: null,
    actor: null,
  };
  return { batch, moves: [receipt] };
}

const historiesOf = (...batches: BatchHistory[]) => new Map(batches.map((h) => [h.batch.id, h]));

const line = (
  history: BatchHistory,
  soldCm: number,
  perMeterCents: number,
  extra: Record<string, unknown> = {},
) => ({
  batchId: history.batch.id,
  unit: 'meter' as const,
  quantity: soldCm,
  price: { perUnitCents: perMeterCents },
  refPriceCents: 2000,
  minPriceCents: 1700,
  ...extra,
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

function build(input: NewSaleInput, histories: Map<string, BatchHistory>) {
  return buildSaleAggregate(newSaleSchema.parse(input), histories, idsFor(input.lines.length), {
    deviceId: 'desk',
    now: NOW,
  });
}

function aggregateOf(input: NewSaleInput, histories: Map<string, BatchHistory>): SaleAggregate {
  const built = build(input, histories);
  if (!built.ok) throw new Error(JSON.stringify(built.issues));
  return built.aggregate;
}

const messagesOf = (issues: { message: string }[]) => issues.map((i) => i.message);

/** T1's batch: 50 m that cost 800 dh (16 dh/m). */
const rosa = () => batchOf(5000, 80_000);

describe('sales (SPEC §3, §4)', () => {
  it('T5: 1 m at 18 dh on a 16 dh/m batch (reference 20): capital 1600, profit 200, paid in cash', () => {
    const batch = rosa();
    const built = build(
      { date: DAY, lines: [line(batch, 100, 1800)], paidCents: 1800 },
      historiesOf(batch),
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
    expect(lines[0]).toMatchObject({
      batchId: batch.batch.id,
      unit: 'meter',
      quantity: 100,
      refPriceCents: 2000,
      actualPriceCents: 1800,
      minOverrideBy: null,
    });
    expect(moves[0]).toMatchObject({
      type: 'sale',
      batchId: batch.batch.id,
      unit: 'meter',
      delta: -100,
      refId: lines[0]?.id,
    });
    expect(payment).toMatchObject({ kind: 'payment', amountCents: 1800, method: 'cash' });
    expect(allocation).toMatchObject({
      paymentId: payment?.id,
      saleId: sale.id,
      amountCents: 1800,
    });
    expect(checkSaleAggregate(built.aggregate, historiesOf(batch))).toEqual([]);
  });

  it('T11: at 14 dh on a 16 dh/m batch the sale needs an explicit confirmation; 2 dh/m is a loss', () => {
    const batch = rosa();
    const input = {
      date: DAY,
      lines: [line(batch, 100, 1400, { minOverrideBy: 'owner' })],
      paidCents: 1400,
    };
    expect(build(input, historiesOf(batch))).toEqual({
      ok: false,
      issues: [expect.objectContaining({ message: SALE_ISSUES.belowCostUnconfirmed })],
    });
    const priced = priceSale(newSaleSchema.parse(input), historiesOf(batch));
    expect(priced.lines[0]?.warnings).toEqual(['below_min_price', 'below_cost']);
    expect(priced).toMatchObject({ requiresConfirmation: true, split: { lossCents: 200 } });

    const confirmed = aggregateOf({ ...input, confirmedBelowCost: true }, historiesOf(batch));
    expect(checkSaleAggregate(confirmed, historiesOf(batch))).toEqual([]);
    // The server refuses one that was not confirmed, whatever the device sent.
    const unconfirmed = { ...confirmed, sale: { ...confirmed.sale, confirmedBelowCost: false } };
    expect(checkSaleAggregate(unconfirmed, historiesOf(batch))).toEqual([
      expect.objectContaining({ message: SALE_ISSUES.belowCostUnconfirmed }),
    ]);
  });

  it('a discount that takes the invoice under cost needs the confirmation too (P2)', () => {
    const batch = rosa();
    const input = {
      date: DAY,
      lines: [line(batch, 100, 1800)],
      discountCents: 300,
      paidCents: 1500,
    };
    expect(priceSale(newSaleSchema.parse(input), historiesOf(batch))).toMatchObject({
      requiresConfirmation: true,
      split: { totalCents: 1500, lossCents: 100 },
    });
    expect(
      priceSale(newSaleSchema.parse({ ...input, discountCents: 2000 }), historiesOf(batch)).issues,
    ).toEqual([expect.objectContaining({ message: SALE_ISSUES.discountAboveTotal })]);
  });

  it('costs each line after the earlier ones on the same batch (T3 across one invoice)', () => {
    const piece = batchOf(230, 10_000);
    const input = newSaleSchema.parse({
      date: DAY,
      lines: [line(piece, 100, 5000), line(piece, 100, 5000), line(piece, 30, 5000)],
      paidCents: 11_500,
    });
    const priced = priceSale(input, historiesOf(piece));
    expect(priced.lines.map((l) => l.lineCostCents)).toEqual([4348, 4348, 1304]);
    // The line that empties the batch takes the exact remainder: nothing of the cost is lost.
    expect(priced.lines.reduce((total, l) => total + l.lineCostCents, 0)).toBe(10_000);
  });

  it('a sale split across two batches is one line and one move per batch', () => {
    const [first, second] = [batchOf(300, 4800), batchOf(5000, 80_000)];
    const aggregate = aggregateOf(
      {
        date: DAY,
        lines: [line(first, 300, 1800), line(second, 200, 1800)],
        paidCents: 9000,
      },
      historiesOf(first, second),
    );
    expect(aggregate.lines.map((l) => [l.batchId, l.quantity, l.lineTotalCents])).toEqual([
      [first.batch.id, 300, 5400],
      [second.batch.id, 200, 3600],
    ]);
    expect(aggregate.moves.map((m) => m.delta)).toEqual([-300, -200]);
    expect(aggregate.sale.totalCents).toBe(9000);
  });

  it('credit: the rest needs a customer; a due date only on credit, not before the sale', () => {
    const batch = rosa();
    const customerId = crypto.randomUUID();
    const sale = { date: DAY, lines: [line(batch, 100, 1800)] };
    const issuesOf = (input: Partial<NewSaleInput>) =>
      messagesOf(
        priceSale(newSaleSchema.parse({ ...sale, paidCents: 0, ...input }), historiesOf(batch))
          .issues,
      );
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
      historiesOf(batch),
    );
    expect(credit).toMatchObject({
      payment: null,
      allocation: null,
      sale: { dueDate: '2026-11-30' },
    });
    const deposit = aggregateOf({ ...sale, customerId, paidCents: 500 }, historiesOf(batch));
    expect(deposit.payment).toMatchObject({ customerId, amountCents: 500 });
    expect(checkSaleAggregate(deposit, historiesOf(batch))).toEqual([]);
  });

  it('sells an untouched ready piece whole at its piece price (P5)', () => {
    const piece = batchOf(230, 10_000);
    const whole = {
      date: DAY,
      lines: [{ ...line(piece, 230, 0, { minPriceCents: 0 }), price: { wholePieceCents: 12_000 } }],
      paidCents: 12_000,
    };
    const aggregate = aggregateOf(whole, historiesOf(piece));
    expect(aggregate.lines[0]).toMatchObject({
      wholePiece: true,
      lineTotalCents: 12_000,
      actualPriceCents: 5217,
    });
    expect(checkSaleAggregate(aggregate, historiesOf(piece))).toEqual([]);
    const cut: BatchHistory = {
      ...piece,
      moves: [
        ...piece.moves,
        {
          ...base,
          id: crypto.randomUUID(),
          batchId: piece.batch.id,
          type: 'loss',
          unit: 'meter',
          delta: -10,
          refId: null,
          date: DAY,
          note: 'x',
          actor: null,
        },
      ],
    };
    expect(priceSale(newSaleSchema.parse(whole), historiesOf(cut)).issues).toEqual([
      expect.objectContaining({ message: SALE_ISSUES.wholePieceTouched }),
    ]);
  });

  it('the server refuses records that do not match what was typed, or an unknown batch', () => {
    const batch = rosa();
    const histories = historiesOf(batch);
    const aggregate = aggregateOf(
      { date: DAY, lines: [line(batch, 100, 1800)], paidCents: 1800 },
      histories,
    );
    const [firstLine] = aggregate.lines;
    const [firstMove] = aggregate.moves;
    if (!firstLine || !firstMove || !aggregate.payment) throw new Error('expected records');
    const tampered: SaleAggregate[] = [
      { ...aggregate, sale: { ...aggregate.sale, totalCents: 1700 } },
      { ...aggregate, lines: [{ ...firstLine, lineTotalCents: 1700 }] },
      { ...aggregate, moves: [{ ...firstMove, delta: -90 }] },
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
      expect.objectContaining({ message: SALE_ISSUES.unknownBatch }),
    ]);
    expect(() =>
      buildSaleAggregate(
        newSaleSchema.parse({ date: DAY, lines: [line(batch, 100, 1800)], paidCents: 1800 }),
        histories,
        { ...idsFor(1), paymentId: null },
        { deviceId: 'desk', now: NOW },
      ),
    ).toThrow(RangeError);
  });
});

describe('the minimum selling price (ADR 0012)', () => {
  // 16 dh/m cost, 17 dh/m minimum, 20 dh/m normal.
  const sell = (
    batch: BatchHistory,
    perMeterCents: number,
    extra: Record<string, unknown> = {},
  ) => ({
    date: DAY,
    lines: [line(batch, 100, perMeterCents, extra)],
    paidCents: perMeterCents,
  });

  it('refuses a line under the minimum unless the owner confirmed it', () => {
    const batch = rosa();
    // 16.50: under the minimum (17) but above the cost (16): only the minimum is in the way.
    const priced = priceSale(newSaleSchema.parse(sell(batch, 1650)), historiesOf(batch));
    expect(messagesOf(priced.issues)).toEqual([SALE_ISSUES.belowMinimum]);
    expect(priced.issues[0]?.path).toEqual(['lines', 0, 'price']);
    expect(build(sell(batch, 1650), historiesOf(batch))).toMatchObject({ ok: false });
    // At the minimum exactly it is fine.
    expect(build(sell(batch, 1700), historiesOf(batch))).toMatchObject({ ok: true });
  });

  it('lets the owner override it and records who and at which price', () => {
    const batch = rosa();
    const input = sell(batch, 1650, { minOverrideBy: 'oussama' });
    const built = build(input, historiesOf(batch));
    if (!built.ok) throw new Error(JSON.stringify(built.issues));
    expect(built.priced.belowMinimum).toBe(true);
    // Above the cost: the under-cost confirmation is not involved.
    expect(built.priced.requiresConfirmation).toBe(false);
    expect(built.aggregate.sale.confirmedBelowCost).toBe(false);
    expect(built.aggregate.lines[0]).toMatchObject({
      actualPriceCents: 1650,
      lineTotalCents: 1650,
      minPriceCents: 1700,
      minOverrideBy: 'oussama',
    });
    expect(checkSaleAggregate(built.aggregate, historiesOf(batch))).toEqual([]);
    // The record carries the override: dropping it is a different sale, so the server refuses it.
    const [overridden] = built.aggregate.lines;
    if (!overridden) throw new Error('expected a line');
    const dropped = { ...built.aggregate, lines: [{ ...overridden, minOverrideBy: null }] };
    expect(messagesOf(checkSaleAggregate(dropped, historiesOf(batch)))).toEqual([
      SALE_ISSUES.belowMinimum,
    ]);
  });

  it('keeps the under-cost confirmation separate from the minimum-price override', () => {
    const batch = rosa();
    const histories = historiesOf(batch);
    // 14 dh: under the minimum AND under the cost (16): two different decisions.
    const both = { ...sell(batch, 1400, { minOverrideBy: 'oussama' }), confirmedBelowCost: true };
    expect(build(both, histories)).toMatchObject({ ok: true });
    // Only the cost confirmation: the minimum still blocks.
    const costOnly = { ...sell(batch, 1400), confirmedBelowCost: true };
    expect(
      messagesOf((build(costOnly, histories) as { issues: { message: string }[] }).issues),
    ).toEqual([SALE_ISSUES.belowMinimum]);
    // Only the override: the cost confirmation still blocks.
    const overrideOnly = sell(batch, 1400, { minOverrideBy: 'oussama' });
    expect(
      messagesOf((build(overrideOnly, histories) as { issues: { message: string }[] }).issues),
    ).toEqual([SALE_ISSUES.belowCostUnconfirmed]);
  });

  it('does not accept an override on a line that is not under the minimum', () => {
    const batch = rosa();
    const priced = priceSale(
      newSaleSchema.parse(sell(batch, 1800, { minOverrideBy: 'oussama' })),
      historiesOf(batch),
    );
    expect(messagesOf(priced.issues)).toEqual([SALE_ISSUES.overrideNotNeeded]);
  });

  it('judges a whole piece against the minimum for its length', () => {
    const piece = batchOf(230, 8000);
    const whole = (wholePieceCents: number, extra: Record<string, unknown> = {}) => ({
      date: DAY,
      lines: [
        {
          ...line(piece, 230, 0, { minPriceCents: 4000, ...extra }),
          price: { wholePieceCents },
        },
      ],
      paidCents: wholePieceCents,
    });
    // 2.30 m at 40 dh/m: the floor is exactly 92 dh.
    expect(build(whole(9200), historiesOf(piece))).toMatchObject({ ok: true });
    expect(
      messagesOf(
        (build(whole(9199), historiesOf(piece)) as { issues: { message: string }[] }).issues,
      ),
    ).toEqual([SALE_ISSUES.belowMinimum]);
  });

  it('is enforced again on the server against the product, whatever the device stored', () => {
    const batch = rosa();
    // A device that stored no minimum on the line (stale or tampered) priced it freely...
    const input = sell(batch, 1650, { minPriceCents: 0 });
    const aggregate = aggregateOf(input, historiesOf(batch));
    expect(checkSaleAggregate(aggregate, historiesOf(batch))).toEqual([]);
    // ...but the product says 17 dh/m, and the server judges the line against that.
    const minimums = (batchId: string) =>
      batchId === batch.batch.id ? { meter: 1700, piece: 0 } : undefined;
    expect(messagesOf(checkSaleMinimums(aggregate.lines, minimums))).toEqual([
      SALE_ISSUES.belowMinimum,
    ]);
    // An owner's override is accepted; a product without a minimum has nothing to enforce.
    const overridden = aggregate.lines.map((l) => ({ ...l, minOverrideBy: 'oussama' }));
    expect(checkSaleMinimums(overridden, minimums)).toEqual([]);
    expect(checkSaleMinimums(aggregate.lines, () => ({ meter: 0, piece: 0 }))).toEqual([]);
    expect(checkSaleMinimums(aggregate.lines, () => undefined)).toEqual([]);
  });
});

describe('selling by the piece and from weight', () => {
  const pieces = (count: number, costTotalCents: number) =>
    batchOf(count, costTotalCents, { pieces: true });
  const pieceLine = (
    history: BatchHistory,
    quantity: number,
    perPieceCents: number,
    extra = {},
  ) => ({
    batchId: history.batch.id,
    unit: 'piece' as const,
    quantity,
    price: { perUnitCents: perPieceCents },
    refPriceCents: 1000,
    minPriceCents: 700,
    ...extra,
  });

  it('prices piece lines per piece and costs them from the batch', () => {
    const stock = pieces(10, 5000); // 50 dh a piece
    const aggregate = aggregateOf(
      { date: DAY, lines: [pieceLine(stock, 3, 800)], paidCents: 2400 },
      historiesOf(stock),
    );
    expect(aggregate.lines[0]).toMatchObject({
      unit: 'piece',
      quantity: 3,
      actualPriceCents: 800,
      lineTotalCents: 2400,
    });
    expect(aggregate.moves[0]).toMatchObject({ unit: 'piece', delta: -3 });
    const ledger = batchLedgerOf(stock.batch, [...stock.moves, ...aggregate.moves]);
    expect(ledger.available.piece).toEqual({ unit: 'piece', pieces: 7 });
    expect(ledger.costs).toEqual([{ moveId: aggregate.moves[0]?.id, costCents: 1500 }]);
    expect(checkSaleAggregate(aggregate, historiesOf(stock))).toEqual([]);
  });

  it('applies the per-piece minimum to piece lines', () => {
    const stock = pieces(10, 5000);
    const input = { date: DAY, lines: [pieceLine(stock, 2, 600)], paidCents: 1200 };
    expect(
      messagesOf((build(input, historiesOf(stock)) as { issues: { message: string }[] }).issues),
    ).toEqual([SALE_ISSUES.belowMinimum]);
    const owner = { ...input, lines: [pieceLine(stock, 2, 600, { minOverrideBy: 'oussama' })] };
    expect(build({ ...owner, confirmedBelowCost: true }, historiesOf(stock))).toMatchObject({
      ok: true,
    });
  });

  it('refuses a unit the batch cannot be sold in', () => {
    const stock = pieces(10, 5000);
    const cloth = rosa();
    const unitIssues = (input: NewSaleInput, histories: Map<string, BatchHistory>) =>
      messagesOf(priceSale(newSaleSchema.parse(input), histories).issues);
    // Meters from pieces, and pieces from a length.
    expect(
      unitIssues(
        { date: DAY, lines: [line(stock, 100, 1800)], paidCents: 1800 },
        historiesOf(stock),
      ),
    ).toEqual([SALE_ISSUES.unitNotAvailable]);
    expect(
      unitIssues(
        { date: DAY, lines: [pieceLine(cloth, 1, 1800)], paidCents: 1800 },
        historiesOf(cloth),
      ),
    ).toEqual([SALE_ISSUES.unitNotAvailable]);
  });

  it('sells meters from weight only once its length is known', () => {
    const waiting = batchOf(0, 10_000, { awaiting: true });
    const input = { date: DAY, lines: [line(waiting, 100, 2000)], paidCents: 2000 };
    expect(messagesOf(priceSale(newSaleSchema.parse(input), historiesOf(waiting)).issues)).toEqual([
      SALE_ISSUES.unitNotAvailable,
    ]);
    // Measured at 80 m: the weight now has meters, costed at the batch's cost over that length.
    const measured: BatchHistory = {
      ...waiting,
      moves: [
        ...waiting.moves,
        {
          ...base,
          id: crypto.randomUUID(),
          batchId: waiting.batch.id,
          type: 'measurement',
          unit: 'meter',
          delta: 8000,
          refId: null,
          date: DAY,
          note: null,
          actor: 'oussama',
        },
      ],
    };
    const built = build(input, historiesOf(measured));
    if (!built.ok) throw new Error(JSON.stringify(built.issues));
    expect(built.priced.lines[0]).toMatchObject({ lineCostCents: 125, profitCents: 1875 });
  });
});

describe('voiding a sale (P13)', () => {
  it('puts the cloth back as if the lines had never been sold, and refunds what was paid', () => {
    const [first, second] = [batchOf(300, 4800), batchOf(5000, 80_000)];
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
      returns: [],
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
    expect(voided.reversals.map((m) => [m.type, m.refId, m.delta, m.unit])).toEqual(
      sorted.map((m) => ['reversal', m.id, -m.delta, m.unit]),
    );
    const after = batchLedgerOf(first.batch, [
      ...first.moves,
      ...aggregate.moves.filter((m) => m.batchId === first.batch.id),
      ...voided.reversals.filter((m) => m.batchId === first.batch.id),
    ]);
    expect(after).toMatchObject({ costs: [], unallocatedCostCents: 4800 });
    expect(after.available.meter).toEqual({ unit: 'meter', centimeters: 300 });

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
    const batch = rosa();
    const aggregate = aggregateOf(
      { date: DAY, customerId: crypto.randomUUID(), lines: [line(batch, 100, 1800)], paidCents: 0 },
      historiesOf(batch),
    );
    const voided = buildSaleVoid(
      { reason: 'ألغى الزبون', date: DAY },
      { sale: aggregate.sale, moves: aggregate.moves, allocations: [], returns: [] },
      { voidId: crypto.randomUUID(), reversalIds: [crypto.randomUUID()], refundId: null },
      { deviceId: 'desk', now: NOW },
    );
    expect(voided).toMatchObject({ refund: null, saleVoid: { refundId: null } });
  });
});

describe('saleFigures (P9, P10)', () => {
  it('T8: 200 dh costing 160 on credit, paid 100 then 100 → capital 100 / 0, then 60 / 40', () => {
    const batch = rosa();
    const aggregate = aggregateOf(
      {
        date: DAY,
        customerId: crypto.randomUUID(),
        lines: [line(batch, 1000, 2000)],
        paidCents: 0,
      },
      historiesOf(batch),
    );
    const ledger = batchLedgerOf(batch.batch, [...batch.moves, ...aggregate.moves]);
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
      new Map([[batch.batch.id, ledger]]),
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

  it('derives each line’s cost from its batch, and what was paid and is still due', () => {
    const batch = batchOf(8000, 40_000, { estimated: true });
    const aggregate = aggregateOf(
      {
        date: DAY,
        customerId: crypto.randomUUID(),
        lines: [line(batch, 100, 1800)],
        paidCents: 500,
      },
      historiesOf(batch),
    );
    const ledger = batchLedgerOf(batch.batch, [...batch.moves, ...aggregate.moves]);
    const allocations = aggregate.allocation ? [aggregate.allocation] : [];
    const figures = saleFigures(
      aggregate.sale,
      aggregate.lines,
      aggregate.moves,
      new Map([[batch.batch.id, ledger]]),
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
      new Map([[batch.batch.id, ledger]]),
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
