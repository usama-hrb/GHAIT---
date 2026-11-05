import {
  CM_PER_METER,
  monthBounds,
  monthOf,
  mulDivRoundHalfUp,
  nextMonth,
  periodNetProfit,
  periodResultOf,
  previousMonth,
  shareOfLineCents,
} from '@fabric/core';
import { customerAccountOf } from './receivables.js';
import { returnedQuantityByLine, type SaleReturn } from './returns.js';
import type { Sale } from './sales.js';
import { periodBasisOf } from './settlements.js';
import { availableIn } from './stock.js';
import type { ZakatRecords } from './zakat.js';

/**
 * Reports (SPEC §14.13, BUILD_PROMPTS 5.2): read-only views of the records. Every figure that is
 * accounting (profit, losses, costs, receivables) comes from the same core functions as the
 * settlement and the integrity check; the rest is grouping and summing.
 */
export type ReportRecords = ZakatRecords;

/** Days, inclusive. */
export interface DateRange {
  from: string;
  to: string;
}

const live = <T extends { voidedAt: string | null }>(records: readonly T[]): T[] =>
  records.filter((record) => record.voidedAt === null);
const inRange = (date: string, range: DateRange) => date >= range.from && date <= range.to;
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** Every month (YYYY-MM) a range touches, oldest first. */
export function monthsOf(range: DateRange): string[] {
  const months: string[] = [];
  for (let month = monthOf(range.from); month <= monthOf(range.to); month = nextMonth(month)) {
    months.push(month);
  }
  return months;
}

/** The value of `quantity` of a line's unit at `perUnitCents`: a length in cm is priced per meter. */
const valueOf = (unit: 'meter' | 'piece', perUnitCents: number, quantity: number) =>
  unit === 'meter'
    ? mulDivRoundHalfUp(perUnitCents, quantity, CM_PER_METER)
    : perUnitCents * quantity;

/**
 * Each sale line with its cost (batch ledger, frozen costs kept) and its product, net of what
 * customers gave back: the quantity and revenue kept, the cost it still carries.
 */
function linesOf(records: ReportRecords) {
  const basis = periodBasisOf(records);
  const moveOfLine = new Map<string, string>();
  for (const move of records.stockMoves) {
    if (move.type === 'sale' && move.refId) moveOfLine.set(move.refId, move.id);
  }
  const liveSales = new Map(basis.sales.map(({ sale }) => [sale.id, sale]));
  const returned = returnedQuantityByLine(records.saleReturns);
  const batches = new Map(records.batches.map((batch) => [batch.id, batch]));
  const products = new Map(records.products.map((product) => [product.id, product]));
  const lines = records.saleLines.flatMap((line) => {
    const sale = liveSales.get(line.saleId);
    const batch = batches.get(line.batchId);
    const product = batch ? products.get(batch.productId) : undefined;
    const moveId = moveOfLine.get(line.id);
    if (!sale || !product) return [];
    // What is left of the line once the goods that came back are taken off (RT1, RT2).
    const given = returned.get(line.id) ?? 0;
    return [
      {
        line,
        sale,
        product,
        quantity: line.quantity - given,
        revenueCents:
          line.lineTotalCents - shareOfLineCents(line.lineTotalCents, line.quantity, given),
        costCents: (moveId === undefined ? undefined : basis.costOf.get(moveId)) ?? 0,
      },
    ];
  });
  return { basis, lines, products };
}

/**
 * Profit month by month: sales and their gross profit by sale date (total − capital, P4) less the
 * returns of the month, and the period result as a settlement would count it (recognized profit
 * net of returns, losses, paid expenses, cash over/short), before any carried deficit.
 */
export function profitByMonth(records: ReportRecords, range: DateRange) {
  const { basis } = linesOf(records);
  return monthsOf(range).map((month) => {
    const { end } = monthBounds(month);
    const after = monthBounds(previousMonth(month)).end;
    const sales = basis.sales.filter(({ period }) => monthOf(period.date) === month);
    // Goods given back count in the month of the return, not of the sale (RT4).
    const returns = basis.sales
      .flatMap(({ period }) => period.returns ?? [])
      .filter((given) => monthOf(given.date) === month);
    const result = periodResultOf(basis.records, { after, end }, 0);
    const { lossesCents, netProfitCents } = periodNetProfit(result);
    return {
      month,
      salesCents:
        sum(sales.map(({ period }) => period.totalCents)) -
        sum(returns.map((given) => given.creditCents)),
      grossProfitCents:
        sum(sales.map(({ period }) => period.totalCents - period.capitalCents)) -
        sum(returns.map((given) => given.creditCents - given.costCents)),
      recognizedProfitCents:
        result.recognizedProfitCents + result.returnsEffectCents + result.recoveredBadDebtCents,
      lossesCents,
      expensesCents: result.expensesCents,
      cashOverShortCents: result.cashOverShortCents,
      netProfitCents,
    };
  });
}

/** Every day (YYYY-MM-DD) of a range, oldest first. */
export function daysOf(range: DateRange): string[] {
  const days: string[] = [];
  const last = Date.parse(`${range.to}T00:00:00Z`);
  for (let at = Date.parse(`${range.from}T00:00:00Z`); at <= last; at += DAY_MS) {
    days.push(new Date(at).toISOString().slice(0, 10));
  }
  return days;
}

/** What the daily sales read: no cost, so a till that is never sent costs can compute it. */
export interface DailySalesRecords {
  sales: readonly Sale[];
  saleReturns: readonly SaleReturn[];
}

/**
 * Sales day by day, every day of the range (a quiet day is a row of zeros). The same definition
 * as `profitByMonth().salesCents`: a sale counts on its date, and goods given back lower the day
 * of the return, not of the sale (RT4); voided sales and voided returns count for nothing. No
 * cost is read, so the sum of a month's days is that month's sales in the profit report.
 */
export function salesByDay(records: DailySalesRecords, range: DateRange) {
  const liveSales = live(records.sales);
  const liveIds = new Set(liveSales.map((sale) => sale.id));
  const rows = new Map(
    daysOf(range).map((date) => [date, { date, salesCents: 0, salesCount: 0, returnedCents: 0 }]),
  );
  for (const sale of liveSales) {
    const row = rows.get(sale.date);
    if (!row) continue;
    row.salesCents += sale.totalCents;
    row.salesCount += 1;
  }
  for (const given of live(records.saleReturns)) {
    const row = rows.get(given.date);
    if (!row || !liveIds.has(given.saleId)) continue;
    row.salesCents -= given.creditCents;
    row.returnedCents += given.creditCents;
  }
  return [...rows.values()];
}

/**
 * Gross profit day by day: a sale's total less its capital (batch cost, P4) on its date, less the
 * profit goods given back take away on the day of the return (RT4). The same definition as
 * `profitByMonth().grossProfitCents`, so a month's days add up to it. It reads the cost of every
 * sale, so it throws, like the settlement, when a sale line has none: callers that cannot trust
 * the costs leave the figure out instead of showing a wrong one.
 */
export function grossProfitByDay(records: ReportRecords, range: DateRange) {
  const basis = periodBasisOf(records);
  const rows = new Map(daysOf(range).map((date) => [date, { date, grossProfitCents: 0 }]));
  for (const { period } of basis.sales) {
    const row = rows.get(period.date);
    if (row) row.grossProfitCents += period.totalCents - period.capitalCents;
    for (const given of period.returns ?? []) {
      const day = rows.get(given.date);
      if (day) day.grossProfitCents -= given.creditCents - given.costCents;
    }
  }
  return [...rows.values()];
}

/** What each product sold in the range: quantity, revenue, cost and profit of its lines (P4). */
export function salesByProduct(records: ReportRecords, range: DateRange) {
  const { lines } = linesOf(records);
  const rows = new Map<
    string,
    {
      productId: string;
      productName: string;
      /** Sold by the meter, in cm. */
      soldCm: number;
      /** Sold by the piece. */
      soldPieces: number;
      revenueCents: number;
      costCents: number;
      profitCents: number;
    }
  >();
  for (const { line, sale, product, quantity, revenueCents, costCents } of lines) {
    if (!inRange(sale.date, range) || quantity === 0) continue;
    const row = rows.get(product.id) ?? {
      productId: product.id,
      productName: product.name,
      soldCm: 0,
      soldPieces: 0,
      revenueCents: 0,
      costCents: 0,
      profitCents: 0,
    };
    if (line.unit === 'meter') row.soldCm += quantity;
    else row.soldPieces += quantity;
    row.revenueCents += revenueCents;
    row.costCents += costCents;
    row.profitCents += revenueCents - costCents;
    rows.set(product.id, row);
  }
  return [...rows.values()].sort((a, b) => b.revenueCents - a.revenueCents);
}

/**
 * Products in stock, the slowest first: days since the last sale (since the oldest purchase of
 * what is left when never sold), with what is left and its value at cost.
 */
export function slowMoving(records: ReportRecords, today: string) {
  const { basis, lines, products } = linesOf(records);
  const lastSale = new Map<string, string>();
  for (const { sale, product, quantity } of lines) {
    if (quantity === 0) continue; // everything came back: it was not sold
    const known = lastSale.get(product.id);
    if (!known || sale.date > known) lastSale.set(product.id, sale.date);
  }
  const rows = new Map<
    string,
    {
      productId: string;
      productName: string;
      remainingCm: number;
      remainingPieces: number;
      costCents: number;
      lastSale: string | null;
      since: string;
    }
  >();
  for (const batch of records.batches) {
    const ledger = basis.ledgers.get(batch.id);
    const product = products.get(batch.productId);
    if (!ledger || !product) continue;
    const meters = availableIn(ledger, 'meter');
    const pieces = availableIn(ledger, 'piece');
    if (meters <= 0 && pieces <= 0 && ledger.awaitingMeasurement === null) continue;
    const row = rows.get(product.id) ?? {
      productId: product.id,
      productName: product.name,
      remainingCm: 0,
      remainingPieces: 0,
      costCents: 0,
      lastSale: lastSale.get(product.id) ?? null,
      since: batch.purchaseDate,
    };
    row.remainingCm += Math.max(0, meters);
    row.remainingPieces += Math.max(0, pieces);
    row.costCents += ledger.unallocatedCostCents;
    if (batch.purchaseDate < row.since) row.since = batch.purchaseDate;
    rows.set(product.id, row);
  }
  return [...rows.values()]
    .map((row) => ({ ...row, daysIdle: daysBetween(row.lastSale ?? row.since, today) }))
    .sort((a, b) => b.daysIdle - a.daysIdle);
}

/**
 * Negotiation (SPEC §3): what lines sold for against the reference price, per customer or per
 * fabric. discount = reference total − sold total (negative: sold above the reference);
 * discountBp = discount ÷ reference total, in basis points, rounded half up.
 */
export function negotiation(records: ReportRecords, range: DateRange, by: 'customer' | 'product') {
  const { lines } = linesOf(records);
  const customers = new Map(records.customers.map((customer) => [customer.id, customer.name]));
  const rows = new Map<
    string,
    { key: string; name: string; lines: number; refCents: number; soldCents: number }
  >();
  for (const { line, sale, product, quantity, revenueCents } of lines) {
    if (!inRange(sale.date, range) || quantity === 0) continue;
    const key = by === 'customer' ? (sale.customerId ?? '') : product.id;
    const name = by === 'customer' ? (customers.get(key) ?? '') : product.name;
    const row = rows.get(key) ?? { key, name, lines: 0, refCents: 0, soldCents: 0 };
    row.lines += 1;
    row.refCents += valueOf(line.unit, line.refPriceCents, quantity);
    row.soldCents += revenueCents;
    rows.set(key, row);
  }
  return [...rows.values()]
    .map((row) => {
      const discountCents = row.refCents - row.soldCents;
      const sign = discountCents < 0 ? -1 : 1;
      const discountBp =
        row.refCents === 0
          ? 0
          : sign * mulDivRoundHalfUp(Math.abs(discountCents), 10_000, row.refCents);
      return { ...row, discountCents, discountBp };
    })
    .sort((a, b) => b.discountCents - a.discountCents);
}

/** Expenses paid in the range, per category (by paid date, S6), the largest first. */
export function expensesByCategory(records: ReportRecords, range: DateRange) {
  const rows = new Map<string, number>();
  for (const expense of live(records.expenses)) {
    if (expense.paidDate === null || !inRange(expense.paidDate, range)) continue;
    rows.set(expense.category, (rows.get(expense.category) ?? 0) + expense.amountCents);
  }
  return [...rows]
    .map(([category, amountCents]) => ({ category, amountCents }))
    .sort((a, b) => b.amountCents - a.amountCents);
}

export const AGEING_BUCKETS = ['days0to30', 'days31to60', 'days61to90', 'over90'] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

const bucketOf = (days: number): AgeingBucket =>
  days <= 30 ? 'days0to30' : days <= 60 ? 'days31to60' : days <= 90 ? 'days61to90' : 'over90';

/**
 * Receivables ageing: what each customer can still be asked for (customerAccount, written-off
 * invoices left out), by the age of each invoice (days since its sale).
 */
export function receivablesAgeing(records: ReportRecords, today: string) {
  const byCustomer = (id: string) => {
    const sales = records.sales.filter((sale) => sale.customerId === id);
    const payments = records.payments.filter((payment) => payment.customerId === id);
    const paymentIds = new Set(payments.map((payment) => payment.id));
    const saleIds = new Set(sales.map((sale) => sale.id));
    return {
      sales,
      payments,
      allocations: records.allocations.filter((allocation) => paymentIds.has(allocation.paymentId)),
      writeOffs: records.writeOffs.filter((writeOff) => saleIds.has(writeOff.saleId)),
      returns: records.saleReturns.filter((given) => saleIds.has(given.saleId)),
    };
  };
  return live(records.customers)
    .map((customer) => {
      const account = customerAccountOf(byCustomer(customer.id), today);
      const buckets: Record<AgeingBucket, number> = {
        days0to30: 0,
        days31to60: 0,
        days61to90: 0,
        over90: 0,
      };
      for (const invoice of account.openInvoices) {
        if (invoice.writtenOff) continue;
        buckets[bucketOf(daysBetween(invoice.date, today))] += invoice.dueCents;
      }
      return {
        customerId: customer.id,
        name: customer.name,
        ...buckets,
        totalCents: account.collectibleCents,
      };
    })
    .filter((row) => row.totalCents > 0)
    .sort((a, b) => b.over90 - a.over90 || b.totalCents - a.totalCents);
}

/** What is left in stock, per product, at cost and at the normal price (Z1). */
export function stockValue(records: ReportRecords) {
  const { basis, products } = linesOf(records);
  const rows = new Map<
    string,
    {
      productId: string;
      productName: string;
      remainingCm: number;
      remainingPieces: number;
      costCents: number;
      marketCents: number;
    }
  >();
  for (const batch of records.batches) {
    const ledger = basis.ledgers.get(batch.id);
    const product = products.get(batch.productId);
    if (!ledger || !product) continue;
    const meters = Math.max(0, availableIn(ledger, 'meter'));
    const pieces = Math.max(0, availableIn(ledger, 'piece'));
    const waiting = ledger.awaitingMeasurement !== null;
    if (meters <= 0 && pieces <= 0 && !waiting) continue;
    const row = rows.get(product.id) ?? {
      productId: product.id,
      productName: product.name,
      remainingCm: 0,
      remainingPieces: 0,
      costCents: 0,
      marketCents: 0,
    };
    row.remainingCm += meters;
    row.remainingPieces += pieces;
    row.costCents += ledger.unallocatedCostCents;
    // Weight with no length yet has no price per meter: it counts at its cost.
    row.marketCents +=
      valueOf('meter', product.pricePerMeterCents ?? 0, meters) +
      valueOf('piece', product.pricePerPieceCents ?? 0, pieces) +
      (meters <= 0 && pieces <= 0 ? ledger.unallocatedCostCents : 0);
    rows.set(product.id, row);
  }
  return [...rows.values()].sort((a, b) => b.marketCents - a.marketCents);
}

/**
 * The shop's money month by month (the flows of cashBalanceCents, SPEC §9, I5): what came in,
 * what went out, and the balance at each month's end.
 */
export function cashFlowByMonth(records: ReportRecords, range: DateRange) {
  type Flow = { date: string; cents: number; kind: 'in' | 'out' | 'capital' | 'count' };
  const flows: Flow[] = [
    ...live(records.payments).map((p): Flow => ({
      date: p.date,
      cents: p.kind === 'payment' ? p.amountCents : -p.amountCents,
      kind: p.kind === 'payment' ? 'in' : 'out',
    })),
    ...live(records.capitalMoves)
      .filter((m) => m.type !== 'retained_profit')
      .map((m): Flow => ({ date: m.date, cents: m.amountCents, kind: 'capital' })),
    ...live(records.purchases).map((p): Flow => ({
      date: p.date,
      cents: -p.paidCents,
      kind: 'out',
    })),
    ...live(records.supplierPayments).map((p): Flow => ({
      date: p.date,
      cents: -p.amountCents,
      kind: 'out',
    })),
    ...live(records.expenses).flatMap((e): Flow[] =>
      e.paidDate === null ? [] : [{ date: e.paidDate, cents: -e.amountCents, kind: 'out' }],
    ),
    ...live(records.draws).map((d): Flow => ({ date: d.date, cents: -d.amountCents, kind: 'out' })),
    ...live(records.cashAdjustments).map((c): Flow => ({
      date: c.date,
      cents: c.diffCents,
      kind: 'count',
    })),
  ];
  let balance = sum(flows.filter((flow) => flow.date < range.from).map((flow) => flow.cents));
  return monthsOf(range).map((month) => {
    const of = flows.filter((flow) => monthOf(flow.date) === month && inRange(flow.date, range));
    const pick = (kind: Flow['kind']) =>
      sum(of.filter((flow) => flow.kind === kind).map((flow) => flow.cents));
    const netCents = sum(of.map((flow) => flow.cents));
    balance += netCents;
    return {
      month,
      inCents: pick('in'),
      outCents: -pick('out'),
      capitalCents: pick('capital'),
      countsCents: pick('count'),
      netCents,
      balanceCents: balance,
    };
  });
}
