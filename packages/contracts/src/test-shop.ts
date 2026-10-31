import { cashBalanceCents } from '@fabric/core';
import { cashCountFieldsOf, cashFlowsOf } from './cash-counts.js';
import type { IntegrityRecords } from './integrity.js';
import type { Roll, StockMove } from './purchasing.js';
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
  };

  /** One roll bought (and paid) on `date`. */
  roll(costCents: number, lengthCm: number, lengthEstimated = false, date = '2026-09-01'): Roll {
    const purchaseId = crypto.randomUUID();
    this.records.purchases.push({
      ...base(date),
      id: purchaseId,
      supplierId: null,
      date,
      method: lengthEstimated ? 'kg' : 'meter',
      pricePerMeterCents: null,
      weightG: lengthEstimated ? 1000 : null,
      estCmPerKg: lengthEstimated ? lengthCm : null,
      totalCostCents: costCents,
      paidCents: costCents,
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
