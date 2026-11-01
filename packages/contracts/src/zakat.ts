import {
  cashBalanceCents,
  computeZakat,
  effectiveAllocations,
  NISAB_GRAMS,
  splitByOwnership,
  type ZakatResult,
  type ZakatSettings,
} from '@fabric/core';
import { z } from 'zod';
import { cashFlowsOf } from './cash-counts.js';
import { type Fabric, recordBaseSchema, type Supplier, type Variant } from './catalog.js';
import type { Customer } from './customers.js';
import { idSchema, isoDateSchema } from './common.js';
import type { ValidationIssue } from './errors.js';
import type { IntegrityRecords } from './integrity.js';
import { syncOrder } from './order.js';
import { type Partner, type PartnerDraw, partnerDrawSchema } from './partners.js';
import { worthBySaleOf } from './receivables.js';
import { periodBasisOf } from './settlements.js';
import { supplierAccountOf } from './supplier-payments.js';

const cents = z.int();

export const zakatSettingsSchema = z.object({
  nisabMetal: z.enum(Object.keys(NISAB_GRAMS) as [keyof typeof NISAB_GRAMS]),
  goodsValuation: z.enum(['market', 'cost']),
  includeDoubtfulDebts: z.boolean(),
});

/** A metal price entered by hand, with the day it was seen (SPEC §10). */
export const metalPriceSchema = z.object({
  pricePerGramCents: z.int().min(1),
  date: isoDateSchema,
});
export type MetalPrice = z.output<typeof metalPriceSchema>;

/** Every item of the base, with the records it comes from (BUILD_PROMPTS 5.1). */
export const zakatBreakdownSchema = z.object({
  goods: z.array(
    z.object({
      rollId: idSchema,
      /** "R-A0012 · روزا · أحمر". */
      label: z.string(),
      remainingCm: z.int(),
      refPricePerMeterCents: cents,
      costCents: cents,
      valueCents: cents,
    }),
  ),
  goodsCents: cents,
  cashCents: cents,
  receivables: z.array(
    z.object({
      customerId: idSchema,
      name: z.string(),
      amountCents: cents,
      /** Written off as a bad debt (Z5): counted only if the setting says so. */
      doubtful: z.boolean(),
    }),
  ),
  receivablesCents: cents,
  doubtfulReceivablesCents: cents,
  /** Debts due on the shop (SPEC §10): money it holds for customers... */
  debts: z.array(z.object({ customerId: idSchema, name: z.string(), amountCents: cents })),
  /** ...and what it owes its suppliers (SP4); reports saved before supplier debts have none. */
  supplierDebts: z
    .array(z.object({ supplierId: idSchema, name: z.string(), amountCents: cents }))
    .default([]),
  debtsDueCents: cents,
  hawlCompleted: z.boolean(),
  reachesNisab: z.boolean(),
});
export type ZakatBreakdown = z.output<typeof zakatBreakdownSchema>;

/**
 * SPEC §13 `zakat_report`: the base on a hawl with every item, the result against the nisab,
 * and the settings it was computed with. Saved once, never edited; voided with a reason while
 * nothing is paid on it. What is paid is derived from its draws (Z7), not stored.
 */
export const zakatReportSchema = recordBaseSchema.extend({
  /** The hawl (Gregorian; shown in Hijri). */
  hawlDate: isoDateSchema,
  metalPrice: metalPriceSchema,
  nisabCents: cents,
  baseCents: cents,
  zakatDueCents: cents,
  settings: zakatSettingsSchema,
  breakdown: zakatBreakdownSchema,
});
export type ZakatReport = z.output<typeof zakatReportSchema>;
export const storedZakatReportSchema = zakatReportSchema.extend({ serverSeq: z.int().positive() });

/** Paying zakat on a report: an amount, split between the partners by ownership (Z7). */
export const newZakatPaymentSchema = z.object({
  amountCents: z.int().min(1),
  date: isoDateSchema,
});
export type NewZakatPayment = z.output<typeof newZakatPaymentSchema>;

/** GET /zakat/reports/:id: the report, what was paid on it and the draws that paid it. */
export const zakatReportDetailSchema = z.object({
  report: storedZakatReportSchema,
  paidCents: z.int(),
  payments: z.array(partnerDrawSchema.extend({ serverSeq: z.int().positive() })),
});
export type ZakatReportDetail = z.output<typeof zakatReportDetailSchema>;

export const ZAKAT_ISSUES = {
  noHawlStart: 'zakat_hawl_start_missing',
  noPrice: 'zakat_metal_price_missing',
  hawlNotReached: 'zakat_hawl_not_reached',
  hawlTaken: 'zakat_report_exists_for_hawl',
  inconsistent: 'zakat_report_does_not_match_core',
  fixed: 'zakat_report_is_fixed',
  hasPayments: 'zakat_report_has_payments',
  aboveDue: 'zakat_payment_above_due',
} as const;

const issue = (path: (string | number)[], message: string): ValidationIssue => ({
  path,
  message,
  code: 'custom',
});

/** What a zakat report reads: the books, plus names and prices for its items. */
export interface ZakatRecords extends IntegrityRecords {
  fabrics: readonly Fabric[];
  variants: readonly Variant[];
  customers: readonly Customer[];
  suppliers: readonly Supplier[];
}

const live = <T extends { voidedAt: string | null }>(records: readonly T[]): T[] =>
  records.filter((record) => record.voidedAt === null);

/**
 * The shop's position for zakat (SPEC §10, BUILD_PROMPTS 5.1), from the records as they are:
 * each roll with what is left, its reference price and its stock value at cost (Z1); the money
 * (cashBalanceCents, I5); what each customer still owes, written-off debts apart as doubtful
 * (Z5); and the money held for customers as debts due (Z2).
 */
export function zakatPositionOf(records: ZakatRecords): {
  goods: ZakatBreakdown['goods'];
  cashCents: number;
  receivables: ZakatBreakdown['receivables'];
  debts: ZakatBreakdown['debts'];
  supplierDebts: ZakatBreakdown['supplierDebts'];
} {
  const basis = periodBasisOf(records);
  const variants = new Map(records.variants.map((variant) => [variant.id, variant]));
  const fabrics = new Map(records.fabrics.map((fabric) => [fabric.id, fabric]));
  const names = new Map(records.customers.map((customer) => [customer.id, customer.name]));

  const goods = records.rolls.flatMap((roll) => {
    const ledger = basis.ledgers.get(roll.id);
    if (!ledger || ledger.remainingCm <= 0) return [];
    const variant = variants.get(roll.variantId);
    const fabric = variant ? fabrics.get(variant.fabricId) : undefined;
    return [
      {
        rollId: roll.id,
        label: [roll.shortCode, fabric?.name, variant?.colorName].filter(Boolean).join(' · '),
        remainingCm: ledger.remainingCm,
        refPricePerMeterCents: fabric?.refPricePerMeterCents ?? 0,
        costCents: ledger.unallocatedCostCents,
        valueCents: 0,
      },
    ];
  });

  // What each customer still owes, and what the shop holds for them (I7). Allocations count only
  // up to what their invoice is worth after returns: the rest is the customer's money (RT3).
  const owed = new Map<string, { expected: number; doubtful: number }>();
  const liveSales = new Set(basis.sales.map(({ sale }) => sale.id));
  const credit = new Map<string, number>();
  const add = (map: Map<string, number>, key: string, value: number) =>
    map.set(key, (map.get(key) ?? 0) + value);
  const allocations = effectiveAllocations(
    [...records.allocations].sort(syncOrder),
    worthBySaleOf(
      basis.sales.map(({ sale }) => sale),
      records.saleReturns,
    ),
  );
  const appliedBySale = new Map<string, number>();
  for (const allocation of allocations)
    add(appliedBySale, allocation.saleId, allocation.amountCents);
  for (const { sale, period, now } of basis.sales) {
    if (sale.customerId === null) continue;
    const due = now.totalCents - (appliedBySale.get(sale.id) ?? 0);
    const entry = owed.get(sale.customerId) ?? { expected: 0, doubtful: 0 };
    if (due > 0) {
      if (period.writtenOffOn === null) entry.expected += due;
      else entry.doubtful += due;
    }
    owed.set(sale.customerId, entry);
  }
  const payments = new Map(records.payments.map((payment) => [payment.id, payment]));
  const unapplied = new Map<string, number>();
  for (const payment of live(records.payments)) {
    if (payment.customerId === null) continue;
    add(
      unapplied,
      payment.customerId,
      payment.kind === 'payment' ? payment.amountCents : -payment.amountCents,
    );
  }
  for (const allocation of allocations) {
    const customerId = payments.get(allocation.paymentId)?.customerId;
    if (customerId && liveSales.has(allocation.saleId))
      add(unapplied, customerId, -allocation.amountCents);
  }
  for (const [customerId, cents] of unapplied) if (cents > 0) add(credit, customerId, cents);

  const name = (id: string) => names.get(id) ?? '';
  const receivables = [...owed].flatMap(([customerId, { expected, doubtful }]) => [
    ...(expected > 0
      ? [{ customerId, name: name(customerId), amountCents: expected, doubtful: false }]
      : []),
    ...(doubtful > 0
      ? [{ customerId, name: name(customerId), amountCents: doubtful, doubtful: true }]
      : []),
  ]);
  const debts = [...credit].map(([customerId, amountCents]) => ({
    customerId,
    name: name(customerId),
    amountCents,
  }));
  // What the shop owes suppliers is due on it like any debt (SPEC §10, SP4).
  const supplierDebts = live(records.suppliers).flatMap((supplier) => {
    const amountCents = supplierAccountOf(supplier.id, {
      purchases: records.purchases,
      payments: records.supplierPayments,
    }).owedCents;
    return amountCents > 0 ? [{ supplierId: supplier.id, name: supplier.name, amountCents }] : [];
  });
  return {
    goods,
    cashCents: cashBalanceCents(cashFlowsOf(records)),
    receivables,
    debts,
    supplierDebts,
  };
}

/** computeZakat on a breakdown's items: what a report must say. */
function resultOf(
  position: Pick<ZakatBreakdown, 'goods' | 'cashCents' | 'receivables' | 'debts' | 'supplierDebts'>,
  hawlCompleted: boolean,
  settings: ZakatSettings,
  metalPrice: MetalPrice,
): ZakatResult {
  return computeZakat(
    {
      hawlCompleted,
      goods: position.goods.map(({ rollId, remainingCm, refPricePerMeterCents, costCents }) => ({
        rollId,
        remainingCm,
        refPricePerMeterCents,
        costCents,
      })),
      cashCents: Math.max(0, position.cashCents),
      receivables: position.receivables.map(({ customerId, amountCents, doubtful }) => ({
        customerId,
        amountCents,
        doubtful,
      })),
      debtsDueCents: [...position.debts, ...position.supplierDebts].reduce(
        (sum, debt) => sum + debt.amountCents,
        0,
      ),
      [settings.nisabMetal === 'gold' ? 'goldPricePerGramCents' : 'silverPricePerGramCents']:
        metalPrice.pricePerGramCents,
    },
    settings,
  );
}

/** The report's fields for a hawl, from the shop's position (@fabric/core computeZakat, T14). */
export function zakatReportFieldsOf(
  position: ReturnType<typeof zakatPositionOf>,
  input: {
    hawlDate: string;
    hawlCompleted: boolean;
    settings: ZakatSettings;
    metalPrice: MetalPrice;
  },
): Omit<ZakatReport, keyof z.infer<typeof recordBaseSchema>> {
  const result = resultOf(position, input.hawlCompleted, input.settings, input.metalPrice);
  const value = new Map(result.goods.map((item) => [item.rollId, item.valueCents]));
  return {
    hawlDate: input.hawlDate,
    metalPrice: input.metalPrice,
    nisabCents: result.nisabCents,
    baseCents: result.baseCents,
    zakatDueCents: result.zakatDueCents,
    settings: { ...input.settings },
    breakdown: {
      goods: position.goods.map((item) => ({ ...item, valueCents: value.get(item.rollId) ?? 0 })),
      goodsCents: result.goodsCents,
      cashCents: result.cashCents,
      receivables: position.receivables,
      receivablesCents: result.receivablesCents,
      doubtfulReceivablesCents: result.doubtfulReceivablesCents,
      debts: position.debts,
      supplierDebts: position.supplierDebts,
      debtsDueCents: result.debtsDueCents,
      hawlCompleted: result.hawlCompleted,
      reachesNisab: result.reachesNisab,
    },
  };
}

/** Re-checks a pushed report: its figures are what core gives on its own items. */
export function checkZakatReport(report: ZakatReport): ValidationIssue[] {
  const expected = zakatReportFieldsOf(report.breakdown, {
    hawlDate: report.hawlDate,
    hawlCompleted: report.breakdown.hawlCompleted,
    settings: report.settings,
    metalPrice: report.metalPrice,
  });
  const same =
    JSON.stringify([
      expected.nisabCents,
      expected.baseCents,
      expected.zakatDueCents,
      expected.breakdown,
    ]) ===
    JSON.stringify([report.nisabCents, report.baseCents, report.zakatDueCents, report.breakdown]);
  return same ? [] : [issue(['breakdown'], ZAKAT_ISSUES.inconsistent)];
}

/** What has been paid on a report: its live draws (Z7). */
export function zakatPaidCents(reportId: string, draws: readonly PartnerDraw[]): number {
  return live(draws)
    .filter((draw) => draw.zakatReportId === reportId)
    .reduce((sum, draw) => sum + draw.amountCents, 0);
}

/**
 * Paying zakat (SPEC §10 "تُخصم من حساب كل شريك بنسبة ملكيته"): one draw per partner by
 * ownership (largest remainder, an odd cent to the owner, S2), linked to the report (Z7).
 */
export function zakatPaymentShares(
  amountCents: number,
  partners: readonly Partner[],
): { partnerId: string; amountCents: number }[] {
  return splitByOwnership(
    amountCents,
    live(partners).map((partner) => ({
      partnerId: partner.id,
      ownershipBp: partner.ownershipBp,
      isOwner: partner.isOwner,
    })),
  ).filter((share) => share.amountCents > 0);
}
