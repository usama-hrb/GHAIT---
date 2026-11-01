import type { ReportRecords } from '@fabric/contracts';
import type { ShopDatabase } from './db';

/**
 * Every record the whole-shop computations read (the integrity check, zakat, reports), from this
 * device's database, voided ones included.
 */
export async function loadShopRecords(db: ShopDatabase): Promise<ReportRecords> {
  const [
    rolls,
    stockMoves,
    sales,
    saleLines,
    saleReturns,
    allocations,
    writeOffs,
    expenses,
    cashAdjustments,
    lockedCosts,
    settlements,
    splitRules,
  ] = await Promise.all([
    db.rolls.toArray(),
    db.stockMoves.toArray(),
    db.sales.toArray(),
    db.saleLines.toArray(),
    db.saleReturns.toArray(),
    db.paymentAllocations.toArray(),
    db.writeOffs.toArray(),
    db.expenses.toArray(),
    db.cashAdjustments.toArray(),
    db.lockedCosts.toArray(),
    db.settlements.toArray(),
    db.profitSplitRules.toArray(),
  ]);
  const [
    partners,
    payments,
    purchases,
    supplierPayments,
    capitalMoves,
    draws,
    settlementShares,
    fabrics,
    variants,
    customers,
    suppliers,
  ] = await Promise.all([
    db.partners.toArray(),
    db.payments.toArray(),
    db.purchases.toArray(),
    db.supplierPayments.toArray(),
    db.capitalMoves.toArray(),
    db.partnerDraws.toArray(),
    db.settlementShares.toArray(),
    db.fabrics.toArray(),
    db.variants.toArray(),
    db.customers.toArray(),
    db.suppliers.toArray(),
  ]);
  return {
    rolls,
    stockMoves,
    sales,
    saleLines,
    saleReturns,
    allocations,
    writeOffs,
    expenses,
    cashAdjustments,
    lockedCosts,
    settlements,
    splitRules,
    partners,
    payments,
    purchases,
    supplierPayments,
    capitalMoves,
    draws,
    settlementShares,
    fabrics,
    variants,
    customers,
    suppliers,
  };
}
