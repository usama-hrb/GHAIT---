import { cashBalanceCents } from '@fabric/core';
import { cashCountFieldsOf, cashFlowsOf } from './cash-counts.js';
import type { IntegrityRecords } from './integrity.js';
import type { Roll, StockMove } from './purchasing.js';
import { buildSaleReturn, type SaleReturn, type SaleReturnRecords } from './returns.js';
import type { Sale, SaleLine } from './sales.js';
import { buildSettlement, previewSettlement } from './settlements.js';

/**
 * A small shop's records, built the way the app writes them, for the contracts' tests (not
 * exported from the package).
 */

export const dh = (amount: number) => amount * 100;
export const at = (date: string) => `${date}T09:00:00.000Z`;
export const base = (date: string) => ({
  createdAt: at(date),
  updatedAt: at(date),
  deviceId: 'desk',
  voidedAt: null,
});
export const OWNER = crypto.randomUUID();
export const PARTNER = crypto.randomUUID();

let seq = 0;

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? U[] : T[K] };

export class Shop {
  records: Mutable<IntegrityRecords> = {
    rolls: [],
    stockMoves: [],
    sales: [],
    saleLines: [],
    allocations: [],
    writeOffs: [],
    expenses: [],
    cashAdjustments: [],
    lockedCosts: [],
    settlements: [],
    splitRules: [],
    partners: [
      { ...base('2026-09-01'), id: OWNER, name: 'أنا', ownershipBp: 5000, isOwner: true },
      { ...base('2026-09-01'), id: PARTNER, name: 'شريكي', ownershipBp: 5000, isOwner: false },
    ],
    payments: [],
    purchases: [],
    capitalMoves: [],
    draws: [],
    settlementShares: [],
    saleReturns: [],
    supplierPayments: [],
  };

  /**
   * One roll bought on `date`, paid in full unless `credit` says how much of it is left owing
   * to `credit.supplierId` (SP1).
   */
  roll(
    costCents: number,
    lengthCm: number,
    lengthEstimated = false,
    date = '2026-09-01',
    credit?: { supplierId: string; owedCents: number },
  ): Roll {
    const purchaseId = crypto.randomUUID();
    this.records.purchases.push({
      ...base(date),
      id: purchaseId,
      supplierId: credit?.supplierId ?? null,
      date,
      method: lengthEstimated ? 'kg' : 'meter',
      pricePerMeterCents: null,
      weightG: lengthEstimated ? 1000 : null,
      estCmPerKg: lengthEstimated ? lengthCm : null,
      totalCostCents: costCents,
      paidCents: costCents - (credit?.owedCents ?? 0),
      notes: null,
    });
    const roll: Roll = {
      ...base(date),
      id: crypto.randomUUID(),
      shortCode: 'R-A0001',
      variantId: crypto.randomUUID(),
      purchaseId,
      lengthCmInitial: lengthCm,
      costTotalCents: costCents,
      lengthEstimated,
      status: 'active',
    };
    this.records.rolls.push(roll);
    this.move(roll, 'purchase', lengthCm, date);
    return roll;
  }

  move(
    roll: Roll,
    type: StockMove['type'],
    deltaCm: number,
    date: string,
    refId: string | null = null,
  ) {
    const move = {
      ...base(date),
      id: crypto.randomUUID(),
      rollId: roll.id,
      type,
      deltaCm,
      refId,
      date,
      note: null,
      serverSeq: ++seq,
    };
    this.records.stockMoves.push(move);
    return move;
  }

  /** A sale of `soldCm` on one roll for `totalCents`; `paidCents` at the counter. */
  sale(roll: Roll, date: string, soldCm: number, totalCents: number, paidCents = totalCents): Sale {
    const sale: Sale = {
      ...base(date),
      id: crypto.randomUUID(),
      date,
      customerId: paidCents < totalCents ? crypto.randomUUID() : null,
      totalCents,
      discountCents: 0,
      dueDate: null,
      confirmedBelowCost: true,
      note: null,
    };
    const line: SaleLine = {
      ...base(date),
      id: crypto.randomUUID(),
      saleId: sale.id,
      rollId: roll.id,
      soldCm,
      refPricePerMeterCents: 0,
      minPricePerMeterCents: 0,
      actualPricePerMeterCents: 0,
      wholePiece: false,
      lineTotalCents: totalCents,
    };
    this.records.sales.push(sale);
    this.records.saleLines.push(line);
    this.move(roll, 'sale', -soldCm, date, line.id);
    if (paidCents > 0) this.pay(sale, date, paidCents);
    return sale;
  }

  /** A payment of `amountCents` from the sale's customer, `appliedCents` of it to the sale. */
  pay(sale: Sale, date: string, amountCents: number, appliedCents = amountCents) {
    const paymentId = crypto.randomUUID();
    this.records.payments.push({
      ...base(date),
      id: paymentId,
      customerId: sale.customerId,
      kind: 'payment',
      amountCents,
      date,
      method: 'cash',
      note: null,
    });
    const allocation = {
      ...base(date),
      id: crypto.randomUUID(),
      paymentId,
      saleId: sale.id,
      amountCents: appliedCents,
      date,
      serverSeq: ++seq,
    };
    if (appliedCents > 0) this.records.allocations.push(allocation);
    return allocation;
  }

  /** Pays a supplier `amountCents` of what is owed (SP3). */
  paySupplier(
    supplierId: string,
    date: string,
    amountCents: number,
    purchaseId: string | null = null,
  ) {
    this.records.supplierPayments.push({
      ...base(date),
      id: crypto.randomUUID(),
      supplierId,
      purchaseId,
      amountCents,
      date,
      method: 'cash',
      note: null,
    });
  }

  /** What a return of this sale is priced and checked against, from the records so far. */
  returnRecordsOf(sale: Sale): SaleReturnRecords {
    const lines = this.records.saleLines.filter((line) => line.saleId === sale.id);
    const earlier = this.records.saleReturns.filter((given) => given.saleId === sale.id);
    const refundIds = new Set(earlier.map((given) => given.refundId));
    return {
      sale,
      lines,
      moves: this.records.stockMoves.filter(
        (move) => move.type === 'sale' && lines.some((line) => line.id === move.refId),
      ),
      returns: earlier,
      allocations: this.records.allocations.filter((allocation) => allocation.saleId === sale.id),
      refunds: this.records.payments.filter((payment) => refundIds.has(payment.id)),
      writtenOff: this.records.writeOffs.some((writeOff) => writeOff.saleId === sale.id),
    };
  }

  /**
   * The customer gives back `returnedCm` of the sale's first line (RT1); `refundCents` of what
   * they had paid is handed back in cash. Built with the same function the app uses.
   */
  giveBack(sale: Sale, date: string, returnedCm: number, refundCents = 0): SaleReturn {
    const records = this.returnRecordsOf(sale);
    const first = records.lines[0];
    if (!first) throw new Error('a sale with no line');
    const built = buildSaleReturn(
      {
        saleId: sale.id,
        date,
        reason: 'مرتجع',
        lines: [{ lineId: first.id, returnedCm }],
        refundCents,
      },
      records,
      {
        returnId: crypto.randomUUID(),
        moveIds: [crypto.randomUUID()],
        refundId: refundCents > 0 ? crypto.randomUUID() : null,
      },
      { deviceId: 'desk', now: at(date) },
    );
    if (!built.ok) throw new Error(JSON.stringify(built.issues));
    const { saleReturn, moves, refund } = built.aggregate;
    const storedReturn = { ...saleReturn, serverSeq: ++seq };
    this.records.saleReturns.push(storedReturn);
    for (const move of moves) this.records.stockMoves.push({ ...move, serverSeq: ++seq });
    if (refund) {
      const stored = { ...refund, serverSeq: ++seq };
      this.records.payments.push(stored);
    }
    return saleReturn;
  }

  expense(paidDate: string | null, amountCents: number) {
    this.records.expenses.push({
      ...base(paidDate ?? '2026-10-01'),
      id: crypto.randomUUID(),
      date: paidDate ?? '2026-10-01',
      category: 'rent',
      amountCents,
      paidDate,
      note: null,
      recurringExpenseId: null,
    });
  }

  contribute(partnerId: string, amountCents: number, date = '2026-09-01') {
    this.records.capitalMoves.push({
      ...base(date),
      id: crypto.randomUUID(),
      partnerId,
      type: 'contribution',
      amountCents,
      date,
      note: null,
      settlementId: null,
    });
  }

  draw(partnerId: string, amountCents: number, date: string) {
    this.records.draws.push({
      ...base(date),
      id: crypto.randomUUID(),
      partnerId,
      amountCents,
      date,
      reason: 'مصروف شخصي',
      zakatReportId: null,
    });
  }

  /** A cash count of `countedCents` against what the records say now. */
  count(date: string, countedCents: number, note: string | null = null) {
    const expected = cashBalanceCents(cashFlowsOf(this.records));
    const fields = cashCountFieldsOf({ date, countedCents, note }, expected);
    this.records.cashAdjustments.push({ ...base(date), id: crypto.randomUUID(), ...fields });
    return fields;
  }

  preview(periodEnd: string, today = '2027-01-15') {
    const result = previewSettlement(this.records, { periodEnd, today });
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    return result.preview;
  }

  /** Approves what the preview shows, and keeps everything it creates. */
  settle(periodEnd: string, today = '2027-01-15') {
    const expected = this.preview(periodEnd, today).breakdown;
    const built = buildSettlement(
      this.records,
      { periodEnd, expected, today },
      { settlementId: crypto.randomUUID(), newId: () => crypto.randomUUID() },
      { deviceId: 'server', now: at(today) },
    );
    if (!built.ok) throw new Error(JSON.stringify(built.issues));
    const { settlement, shares, retainedProfit, lockedCosts } = built.aggregate;
    this.records.settlements.push(settlement);
    this.records.settlementShares.push(...shares);
    this.records.capitalMoves.push(...retainedProfit);
    this.records.lockedCosts.push(...lockedCosts);
    return built.aggregate;
  }
}
