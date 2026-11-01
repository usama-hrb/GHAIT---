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
import { returnedCmByLine } from './returns.js';
import { periodBasisOf } from './settlements.js';
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

/**
 * Each sale line with its cost (roll ledger, frozen costs kept) and its names, net of what
 * customers gave back: the length and revenue kept, the cost it still carries.
 */
function linesOf(records: ReportRecords) {
  const basis = periodBasisOf(records);
  const moveOfLine = new Map<string, string>();
  for (const move of records.stockMoves) {
    if (move.type === 'sale' && move.refId) moveOfLine.set(move.refId, move.id);
  }
  const liveSales = new Map(basis.sales.map(({ sale }) => [sale.id, sale]));
  const returnedCm = returnedCmByLine(records.saleReturns);
  const rolls = new Map(records.rolls.map((roll) => [roll.id, roll]));
  const variants = new Map(records.variants.map((variant) => [variant.id, variant]));
  const fabrics = new Map(records.fabrics.map((fabric) => [fabric.id, fabric]));
  const lines = records.saleLines.flatMap((line) => {
    const sale = liveSales.get(line.saleId);
    const roll = rolls.get(line.rollId);
    const variant = roll ? variants.get(roll.variantId) : undefined;
    const fabric = variant ? fabrics.get(variant.fabricId) : undefined;
    const moveId = moveOfLine.get(line.id);
    if (!sale || !variant) return [];
    // What is left of the line once the goods that came back are taken off (RT1, RT2).
    const given = returnedCm.get(line.id) ?? 0;
    return [
      {
        line,
        sale,
        variant,
        fabric,
        soldCm: line.soldCm - given,
        revenueCents:
          line.lineTotalCents - shareOfLineCents(line.lineTotalCents, line.soldCm, given),
        costCents: (moveId === undefined ? undefined : basis.costOf.get(moveId)) ?? 0,
      },
    ];
  });
  return { basis, lines, variants, fabrics };
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

/** What each colour sold in the range: length, revenue, cost and profit of its lines (P4). */
export function salesByColor(records: ReportRecords, range: DateRange) {
  const { lines } = linesOf(records);
  const rows = new Map<
    string,
    {
      variantId: string;
      fabricId: string;
      fabricName: string;
      colorName: string;
      soldCm: number;
      revenueCents: number;
      costCents: number;
      profitCents: number;
    }
  >();
  for (const { sale, variant, fabric, soldCm, revenueCents, costCents } of lines) {
    if (!inRange(sale.date, range) || soldCm === 0) continue;
    const row = rows.get(variant.id) ?? {
      variantId: variant.id,
      fabricId: variant.fabricId,
      fabricName: fabric?.name ?? '',
      colorName: variant.colorName,
      soldCm: 0,
      revenueCents: 0,
      costCents: 0,
      profitCents: 0,
    };
    row.soldCm += soldCm;
    row.revenueCents += revenueCents;
    row.costCents += costCents;
    row.profitCents += revenueCents - costCents;
    rows.set(variant.id, row);
  }
  return [...rows.values()].sort((a, b) => b.revenueCents - a.revenueCents);
}

/** The same, fabric by fabric. */
export function salesByFabric(records: ReportRecords, range: DateRange) {
  const rows = new Map<
    string,
    {
      fabricId: string;
      fabricName: string;
      soldCm: number;
      revenueCents: number;
      costCents: number;
      profitCents: number;
    }
  >();
  for (const color of salesByColor(records, range)) {
    const row = rows.get(color.fabricId) ?? {
      fabricId: color.fabricId,
      fabricName: color.fabricName,
      soldCm: 0,
      revenueCents: 0,
      costCents: 0,
      profitCents: 0,
    };
    row.soldCm += color.soldCm;
    row.revenueCents += color.revenueCents;
    row.costCents += color.costCents;
    row.profitCents += color.profitCents;
    rows.set(color.fabricId, row);
  }
  return [...rows.values()].sort((a, b) => b.revenueCents - a.revenueCents);
}

/**
 * Colours in stock, the slowest first: days since the last sale (since the oldest purchase of
 * what is left when never sold), with what is left and its value at cost.
 */
export function slowMoving(records: ReportRecords, today: string) {
  const { basis, lines, variants, fabrics } = linesOf(records);
  const lastSale = new Map<string, string>();
  for (const { sale, variant, soldCm } of lines) {
    if (soldCm === 0) continue; // everything came back: it was not sold
    const known = lastSale.get(variant.id);
    if (!known || sale.date > known) lastSale.set(variant.id, sale.date);
  }
  const purchases = new Map(records.purchases.map((purchase) => [purchase.id, purchase.date]));
  const rows = new Map<
    string,
    {
      variantId: string;
      fabricName: string;
      colorName: string;
      remainingCm: number;
      costCents: number;
      lastSale: string | null;
      since: string;
    }
  >();
  for (const roll of records.rolls) {
    const ledger = basis.ledgers.get(roll.id);
    const variant = variants.get(roll.variantId);
    if (!ledger || ledger.remainingCm <= 0 || !variant) continue;
    const bought = purchases.get(roll.purchaseId) ?? roll.createdAt.slice(0, 10);
    const row = rows.get(variant.id) ?? {
      variantId: variant.id,
      fabricName: fabrics.get(variant.fabricId)?.name ?? '',
      colorName: variant.colorName,
      remainingCm: 0,
      costCents: 0,
      lastSale: lastSale.get(variant.id) ?? null,
      since: bought,
    };
    row.remainingCm += ledger.remainingCm;
    row.costCents += ledger.unallocatedCostCents;
    if (bought < row.since) row.since = bought;
    rows.set(variant.id, row);
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
export function negotiation(records: ReportRecords, range: DateRange, by: 'customer' | 'fabric') {
  const { lines } = linesOf(records);
  const customers = new Map(records.customers.map((customer) => [customer.id, customer.name]));
  const rows = new Map<
    string,
    { key: string; name: string; lines: number; refCents: number; soldCents: number }
  >();
  for (const { line, sale, fabric, soldCm, revenueCents } of lines) {
    if (!inRange(sale.date, range) || soldCm === 0) continue;
    const key = by === 'customer' ? (sale.customerId ?? '') : (fabric?.id ?? '');
    const name = by === 'customer' ? (customers.get(key) ?? '') : (fabric?.name ?? '');
    const row = rows.get(key) ?? { key, name, lines: 0, refCents: 0, soldCents: 0 };
    row.lines += 1;
    row.refCents += mulDivRoundHalfUp(line.refPricePerMeterCents, soldCm, CM_PER_METER);
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

/** What is left in stock, per fabric, at cost and at the reference price (Z1). */
export function stockValue(records: ReportRecords) {
  const { basis, variants, fabrics } = linesOf(records);
  const rows = new Map<
    string,
    {
      fabricId: string;
      fabricName: string;
      remainingCm: number;
      costCents: number;
      marketCents: number;
    }
  >();
  for (const roll of records.rolls) {
    const ledger = basis.ledgers.get(roll.id);
    const variant = variants.get(roll.variantId);
    const fabric = variant ? fabrics.get(variant.fabricId) : undefined;
    if (!ledger || ledger.remainingCm <= 0 || !fabric) continue;
    const row = rows.get(fabric.id) ?? {
      fabricId: fabric.id,
      fabricName: fabric.name,
      remainingCm: 0,
      costCents: 0,
      marketCents: 0,
    };
    row.remainingCm += ledger.remainingCm;
    row.costCents += ledger.unallocatedCostCents;
    row.marketCents += mulDivRoundHalfUp(
      fabric.refPricePerMeterCents,
      ledger.remainingCm,
      CM_PER_METER,
    );
    rows.set(fabric.id, row);
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
