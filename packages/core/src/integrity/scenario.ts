import { allocateLineCost } from '../costing/index.js';
import {
  amountDueCents,
  overpaymentCents,
  returnCreditCents,
  shareOfLineCents,
  splitSaleCapitalProfit,
} from '../payments/index.js';
import { computeSaleLine } from '../pricing/index.js';
import {
  computeSettlement,
  DEFAULT_SPLIT_WEIGHTS,
  partnerBalance,
  partnerCapital,
  type PartnerOwnership,
  periodNetProfit,
  type PeriodResult,
  periodResultOf,
  type Settlement,
} from '../settlement/index.js';
import {
  cashBalanceCents,
  type IntegrityState,
  receivablesPosition,
  stockAtCostCents,
} from './check.js';

/**
 * A deterministic shop simulator for tests (BUILD_PROMPTS 1.5, T13). It applies events with
 * core functions only and keeps the records the database keeps; integrityStateOf then derives
 * the integrity check's amounts from those records alone, so a test can corrupt one record
 * and see the difference.
 *
 * Any sequence of events is a valid history: roll and sale numbers pick among the current ones
 * (modulo), lengths and cash amounts are brought into range (no overselling, no negative cash),
 * and an event that cannot apply (nothing to sell, no cash) is skipped. Not exported from the
 * package.
 */

export type PartnerRole = 'owner' | 'partner';

export type ScenarioEvent =
  | { type: 'contribution'; partner: PartnerRole; amountCents: number }
  /**
   * One roll. Paid in cash in full, unless `paidCents` is given: then that much (at most the cost
   * and the cash in the till) is paid and the rest is owed to the supplier (SP1).
   */
  | { type: 'purchase'; lengthCm: number; costCents: number; paidCents?: number }
  /** Pays the suppliers down (SP3), at most what is owed and what the till holds. */
  | { type: 'supplier_payment'; amountCents: number }
  /**
   * A customer gives back part of the sale's cloth (RT1–RT4); `refundCents` of the overpayment it
   * creates is handed back in cash, the rest stays as the customer's credit.
   */
  | { type: 'return'; sale: number; returnedCm: number; refundCents: number }
  /** One line on one roll; paidCents 0 is a credit sale, any amount over the total an overpayment. */
  | { type: 'sale'; roll: number; soldCm: number; pricePerMeterCents: number; paidCents: number }
  | { type: 'payment'; sale: number; amountCents: number }
  /** A payment on a written-off invoice (S5): its capital is recovered first, then profit. */
  | { type: 'recovery'; sale: number; amountCents: number }
  | { type: 'expense'; amountCents: number }
  | { type: 'loss'; roll: number; lengthCm: number }
  /** Writes off an invoice that still has something due (bad debt). */
  | { type: 'write_off'; sale: number }
  | { type: 'draw'; partner: PartnerRole; amountCents: number }
  /** A physical cash count that differs from the books by this much (negative = short). */
  | { type: 'cash_count'; differenceCents: number }
  /** Settles the open period; the next one starts. */
  | { type: 'settlement' };

/** The records, as the database stores them. `period` is the settlement period they fall in. */
export interface Ledger {
  partners: PartnerOwnership[];
  /** The period not settled yet: settlements.length. */
  period: number;
  capitalMoves: {
    partnerId: string;
    type: 'contribution' | 'retained_profit' | 'withdrawal';
    amountCents: number;
  }[];
  purchases: { totalCents: number; paidCents: number }[];
  supplierPayments: { amountCents: number; period: number }[];
  /** Goods given back, in the order recorded (RT1). */
  returns: {
    sale: number;
    returnedCm: number;
    creditCents: number;
    costCents: number;
    refundCents: number;
    /** How many of the sale's payments were recorded before it. */
    afterPayments: number;
    period: number;
  }[];
  rolls: { purchase: number; costTotalCents: number; lengthCm: number }[];
  sales: { period: number; writtenOff: boolean }[];
  saleLines: {
    sale: number;
    roll: number;
    soldCm: number;
    lineTotalCents: number;
    lineCostCents: number;
  }[];
  payments: { sale: number; amountCents: number; period: number }[];
  lossMoves: { roll: number; lengthCm: number; costCents: number; period: number }[];
  writeOffs: { sale: number; period: number }[];
  expenses: { amountCents: number; period: number }[];
  draws: { partnerId: string; amountCents: number; period: number }[];
  cashAdjustments: { diffCents: number; period: number }[];
  settlements: Settlement[];
}

const OWNER_ID = 'owner';
const PARTNER_ID = 'partner';
const SPLIT_RULES = [{ effectiveFrom: '2026-01-01', ...DEFAULT_SPLIT_WEIGHTS }];

/** Period n is month n from January 2026. */
export function periodDates(period: number): { periodStart: string; periodEnd: string } {
  const year = String(2026 + Math.floor(period / 12));
  const month = String((period % 12) + 1).padStart(2, '0');
  return { periodStart: `${year}-${month}-01`, periodEnd: `${year}-${month}-28` };
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
/** Brings any integer into 1…max; a value already in range is kept. */
const inRange = (value: number, max: number) => ((Math.max(1, Math.abs(value)) - 1) % max) + 1;
function pick<T>(items: readonly T[], index: number): T | undefined {
  return items.length === 0 ? undefined : items[Math.abs(index) % items.length];
}

/** What a sale's returns put back so far, in length and cost. */
function returnedOf(ledger: Ledger, sale: number) {
  const given = ledger.returns.filter((entry) => entry.sale === sale);
  return {
    returnedCm: sum(given.map((entry) => entry.returnedCm)),
    creditCents: sum(given.map((entry) => entry.creditCents)),
    costCents: sum(given.map((entry) => entry.costCents)),
    refundCents: sum(given.map((entry) => entry.refundCents)),
  };
}

/** The costs a roll still carries: its sales' costs less what customers gave back, and its losses. */
function rollCosts(ledger: Ledger, roll: number): number[] {
  return [
    ...ledger.saleLines
      .filter((line) => line.roll === roll)
      .map((line) => line.lineCostCents - returnedOf(ledger, line.sale).costCents),
    ...ledger.lossMoves.filter((move) => move.roll === roll).map((move) => move.costCents),
  ];
}

function rollRemainingCm(ledger: Ledger, roll: number, lengthCm: number): number {
  return (
    lengthCm -
    sum(
      ledger.saleLines
        .filter((line) => line.roll === roll)
        .map((line) => line.soldCm - returnedOf(ledger, line.sale).returnedCm),
    ) -
    sum(ledger.lossMoves.filter((move) => move.roll === roll).map((move) => move.lengthCm))
  );
}

function saleSplit(ledger: Ledger, sale: number) {
  return splitSaleCapitalProfit({ lines: ledger.saleLines.filter((line) => line.sale === sale) });
}

/** The invoice as it stands once its returns are taken off (RT4). */
function saleNow(ledger: Ledger, sale: number) {
  const { totalCents, capitalCents } = saleSplit(ledger, sale);
  const given = returnedOf(ledger, sale);
  return {
    totalCents: totalCents - given.creditCents,
    capitalCents: capitalCents - given.costCents,
    refundedCents: given.refundCents,
  };
}

function salePayments(ledger: Ledger, sale: number) {
  return ledger.payments.filter((payment) => payment.sale === sale);
}

function cashCents(ledger: Ledger): number {
  const moves = (type: Ledger['capitalMoves'][number]['type']) =>
    sum(ledger.capitalMoves.filter((move) => move.type === type).map((move) => move.amountCents));
  return cashBalanceCents({
    customerPaymentsCents: sum(ledger.payments.map((payment) => payment.amountCents)),
    customerRefundsCents: sum(ledger.returns.map((entry) => entry.refundCents)),
    contributionsCents: moves('contribution'),
    capitalWithdrawalsCents: -moves('withdrawal'),
    purchasesPaidCents: sum(ledger.purchases.map((purchase) => purchase.paidCents)),
    supplierPaymentsCents: sum(ledger.supplierPayments.map((payment) => payment.amountCents)),
    expensesPaidCents: sum(ledger.expenses.map((expense) => expense.amountCents)),
    drawsCents: sum(ledger.draws.map((draw) => draw.amountCents)),
    cashAdjustmentsCents: sum(ledger.cashAdjustments.map((adjustment) => adjustment.diffCents)),
  });
}

/** The date of a period's records: its first day. */
const dateOf = (period: number) => periodDates(period).periodStart;

/** What a settlement gathers from the records alone (periodResultOf, BUILD_PROMPTS 4.3). */
export function periodResult(ledger: Ledger, period: number): PeriodResult {
  const writtenOffOn = new Map(
    ledger.writeOffs.map((writeOff) => [writeOff.sale, dateOf(writeOff.period)]),
  );
  return periodResultOf(
    {
      sales: ledger.sales.map((sale, index) => {
        const { totalCents, capitalCents } = saleSplit(ledger, index);
        return {
          date: dateOf(sale.period),
          totalCents,
          capitalCents,
          allocations: salePayments(ledger, index).map((payment) => ({
            date: dateOf(payment.period),
            amountCents: payment.amountCents,
          })),
          writtenOffOn: writtenOffOn.get(index) ?? null,
          returns: ledger.returns
            .filter((entry) => entry.sale === index)
            .map((entry) => ({
              date: dateOf(entry.period),
              creditCents: entry.creditCents,
              costCents: entry.costCents,
              after: entry.afterPayments,
            })),
        };
      }),
      losses: ledger.lossMoves.map((move) => ({
        date: dateOf(move.period),
        costCents: move.costCents,
      })),
      expenses: ledger.expenses.map((expense) => ({
        paidDate: dateOf(expense.period),
        amountCents: expense.amountCents,
      })),
      cashAdjustments: ledger.cashAdjustments.map((count) => ({
        date: dateOf(count.period),
        diffCents: count.diffCents,
      })),
    },
    {
      after: period === 0 ? null : periodDates(period - 1).periodEnd,
      end: periodDates(period).periodEnd,
    },
    ledger.settlements[period - 1]?.carryDeficitOutCents ?? 0,
  );
}

/** The integrity check's amounts, derived from the records only. */
export function integrityStateOf(ledger: Ledger): IntegrityState {
  const receivables = receivablesPosition(
    ledger.sales.map((sale, index) => ({
      ...saleNow(ledger, index),
      paymentsCents: salePayments(ledger, index).map((payment) => payment.amountCents),
      writtenOff: sale.writtenOff,
    })),
  );
  const partnerIds = ledger.partners.map((partner) => partner.partnerId);
  return {
    cashCents: cashCents(ledger),
    stockAtCostCents: stockAtCostCents(
      ledger.rolls.map((roll, index) => ({
        costTotalCents: roll.costTotalCents,
        allocatedCostsCents: rollCosts(ledger, index),
      })),
    ),
    unrecoveredCapitalCents: receivables.unrecoveredCapitalCents,
    capitalCents: partnerCapital(ledger.capitalMoves),
    partnerBalancesCents: sum(
      partnerIds.map((id) =>
        partnerBalance(
          ledger.settlements.flatMap((s) =>
            s.partnerShares.filter((share) => share.partnerId === id),
          ),
          ledger.draws.filter((draw) => draw.partnerId === id),
        ),
      ),
    ),
    unsettledNetProfitCents: periodNetProfit(periodResult(ledger, ledger.period)).netProfitCents,
    customerCreditsCents: receivables.customerCreditsCents,
    supplierPayablesCents:
      sum(ledger.purchases.map((purchase) => purchase.totalCents - purchase.paidCents)) -
      sum(ledger.supplierPayments.map((payment) => payment.amountCents)),
  };
}

export function emptyLedger(ownerBp = 5000): Ledger {
  return {
    partners: [
      { partnerId: OWNER_ID, ownershipBp: ownerBp, isOwner: true },
      { partnerId: PARTNER_ID, ownershipBp: 10_000 - ownerBp, isOwner: false },
    ],
    period: 0,
    capitalMoves: [],
    purchases: [],
    supplierPayments: [],
    returns: [],
    rolls: [],
    sales: [],
    saleLines: [],
    payments: [],
    lossMoves: [],
    writeOffs: [],
    expenses: [],
    draws: [],
    cashAdjustments: [],
    settlements: [],
  };
}

/** Applies one event to the ledger (in place). */
export function applyEvent(ledger: Ledger, event: ScenarioEvent): void {
  const period = ledger.period;
  const partnerId = (role: PartnerRole) => (role === 'owner' ? OWNER_ID : PARTNER_ID);
  const cash = cashCents(ledger);
  const rollsLeft = [...ledger.rolls.entries()]
    .map(([roll, state]) => ({
      roll,
      state,
      remainingCm: rollRemainingCm(ledger, roll, state.lengthCm),
    }))
    .filter(({ remainingCm }) => remainingCm > 0);

  switch (event.type) {
    case 'contribution': {
      const amountCents = Math.max(1, Math.abs(event.amountCents));
      ledger.capitalMoves.push({
        partnerId: partnerId(event.partner),
        type: 'contribution',
        amountCents,
      });
      return;
    }
    case 'purchase': {
      let costCents: number;
      let paidCents: number;
      if (event.paidCents === undefined) {
        if (cash < 1) return;
        costCents = inRange(event.costCents, cash);
        paidCents = costCents;
      } else {
        // Bought on credit: only what the till holds can be paid now.
        costCents = Math.max(1, Math.abs(event.costCents));
        paidCents = Math.min(Math.abs(event.paidCents), costCents, Math.max(0, cash));
      }
      ledger.purchases.push({ totalCents: costCents, paidCents });
      ledger.rolls.push({
        purchase: ledger.purchases.length - 1,
        costTotalCents: costCents,
        lengthCm: Math.max(1, Math.abs(event.lengthCm)),
      });
      return;
    }
    case 'sale': {
      const chosen = pick(rollsLeft, event.roll);
      if (!chosen) return;
      const { roll, state, remainingCm } = chosen;
      const price = Math.abs(event.pricePerMeterCents);
      const line = computeSaleLine({
        roll: { costTotalCents: state.costTotalCents, basisLengthCm: state.lengthCm, remainingCm },
        soldCm: inRange(event.soldCm, remainingCm),
        price: { perMeterCents: price },
        refPricePerMeterCents: price,
        minPricePerMeterCents: 0,
        previousCostsCents: rollCosts(ledger, roll),
      });
      // A below-cost line is confirmed by the user (SPEC §3).
      ledger.sales.push({ period, writtenOff: false });
      const sale = ledger.sales.length - 1;
      ledger.saleLines.push({
        sale,
        roll,
        soldCm: line.soldCm,
        lineTotalCents: line.lineTotalCents,
        lineCostCents: line.lineCostCents,
      });
      const paidCents = Math.abs(event.paidCents);
      if (paidCents > 0) ledger.payments.push({ sale, amountCents: paidCents, period });
      return;
    }
    case 'payment': {
      const open = [...ledger.sales.entries()].filter(([, sale]) => !sale.writtenOff);
      const chosen = pick(open, event.sale);
      if (!chosen) return;
      const amountCents = Math.max(1, Math.abs(event.amountCents));
      ledger.payments.push({ sale: chosen[0], amountCents, period });
      return;
    }
    case 'supplier_payment': {
      const owed =
        sum(ledger.purchases.map((purchase) => purchase.totalCents - purchase.paidCents)) -
        sum(ledger.supplierPayments.map((payment) => payment.amountCents));
      const room = Math.min(owed, cash);
      if (room < 1) return;
      ledger.supplierPayments.push({ amountCents: inRange(event.amountCents, room), period });
      return;
    }
    case 'return': {
      const open = ledger.saleLines.filter(
        (line) =>
          !ledger.sales[line.sale]?.writtenOff &&
          line.soldCm - returnedOf(ledger, line.sale).returnedCm > 0,
      );
      const line = pick(open, event.sale);
      if (!line) return;
      const given = returnedOf(ledger, line.sale);
      const returnedCm = inRange(event.returnedCm, line.soldCm - given.returnedCm);
      const creditCents = returnCreditCents({
        lines: [
          {
            soldCm: line.soldCm,
            lineTotalCents: line.lineTotalCents,
            returnedCm: given.returnedCm,
            returningCm: returnedCm,
          },
        ],
        discountCents: 0,
      });
      const costCents =
        shareOfLineCents(line.lineCostCents, line.soldCm, given.returnedCm + returnedCm) -
        shareOfLineCents(line.lineCostCents, line.soldCm, given.returnedCm);
      // Cash handed back never exceeds the overpayment the return creates, nor what the till holds.
      const paid = sum(salePayments(ledger, line.sale).map((payment) => payment.amountCents));
      const total = saleNow(ledger, line.sale).totalCents - creditCents;
      const room = Math.min(overpaymentCents(total, paid, given.refundCents), Math.max(0, cash));
      ledger.returns.push({
        sale: line.sale,
        returnedCm,
        creditCents,
        costCents,
        refundCents: Math.min(Math.abs(event.refundCents), room),
        afterPayments: salePayments(ledger, line.sale).length,
        period,
      });
      return;
    }
    case 'expense': {
      if (cash < 1) return;
      ledger.expenses.push({ amountCents: inRange(event.amountCents, cash), period });
      return;
    }
    case 'loss': {
      const chosen = pick(rollsLeft, event.roll);
      if (!chosen) return;
      const { roll, state, remainingCm } = chosen;
      const lengthCm = inRange(event.lengthCm, remainingCm);
      const { costCents } = allocateLineCost(
        { costTotalCents: state.costTotalCents, basisLengthCm: state.lengthCm, remainingCm },
        lengthCm,
        rollCosts(ledger, roll),
      );
      ledger.lossMoves.push({ roll, lengthCm, costCents, period });
      return;
    }
    case 'write_off': {
      const owing = [...ledger.sales.entries()].filter(([index, sale]) => {
        const paid = salePayments(ledger, index).map((payment) => payment.amountCents);
        return !sale.writtenOff && amountDueCents(saleNow(ledger, index).totalCents, paid) > 0;
      });
      const chosen = pick(owing, event.sale);
      if (!chosen) return;
      const [index, sale] = chosen;
      ledger.writeOffs.push({ sale: index, period });
      sale.writtenOff = true;
      return;
    }
    case 'recovery': {
      const writtenOff = [...ledger.sales.entries()].filter(([, sale]) => sale.writtenOff);
      const chosen = pick(writtenOff, event.sale);
      if (!chosen) return;
      const amountCents = Math.max(1, Math.abs(event.amountCents));
      ledger.payments.push({ sale: chosen[0], amountCents, period });
      return;
    }
    case 'draw': {
      if (cash < 1) return;
      const amountCents = inRange(event.amountCents, cash);
      ledger.draws.push({ partnerId: partnerId(event.partner), amountCents, period });
      return;
    }
    case 'cash_count': {
      // The counted cash cannot be negative: a shortage is at most what the books hold.
      const diffCents = Math.max(event.differenceCents, -Math.max(0, cash));
      if (diffCents === 0) return;
      ledger.cashAdjustments.push({ diffCents, period });
      return;
    }
    case 'settlement': {
      const settlement = computeSettlement({
        ...periodDates(period),
        ...periodResult(ledger, period),
        splitRules: SPLIT_RULES,
        partners: ledger.partners,
      });
      ledger.settlements.push(settlement);
      ledger.capitalMoves.push(...settlement.capitalMoves);
      ledger.period = period + 1;
      return;
    }
  }
}

export function runScenario(events: readonly ScenarioEvent[], ownerBp = 5000): Ledger {
  const ledger = emptyLedger(ownerBp);
  for (const event of events) applyEvent(ledger, event);
  return ledger;
}
