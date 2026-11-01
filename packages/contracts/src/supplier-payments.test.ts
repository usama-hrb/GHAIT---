import { describe, expect, it } from 'vitest';
import {
  checkSupplierPayment,
  checkSupplierPaymentUnchanged,
  integrityReportOf,
  integrityStateOf,
  newSupplierPaymentSchema,
  periodDatesOf,
  supplierAccountOf,
  supplierPaymentSchema,
  supplierStatementOf,
  SUPPLIER_PAYMENT_ISSUES,
  zakatPositionOf,
} from './index.js';
import { at, base, dh, OWNER, Shop } from './test-shop.js';

const SUPPLIER = crypto.randomUUID();

/** 800 dh of cloth bought from a supplier, 300 dh paid at the till. */
function owingShop() {
  const shop = new Shop();
  shop.contribute(OWNER, dh(1000));
  const roll = shop.roll(dh(800), 5000, false, '2026-09-01', {
    supplierId: SUPPLIER,
    owedCents: dh(500),
  });
  return { shop, roll, purchase: shop.records.purchases[0] };
}

const recordsOf = (shop: Shop) => ({
  purchases: shop.records.purchases,
  payments: shop.records.supplierPayments,
});

describe('what the shop owes a supplier (SP1–SP3)', () => {
  it('is the unpaid part of their purchases less what was paid since', () => {
    const { shop, purchase } = owingShop();
    expect(supplierAccountOf(SUPPLIER, recordsOf(shop))).toMatchObject({
      balanceCents: dh(500),
      owedCents: dh(500),
    });
    shop.paySupplier(SUPPLIER, '2026-09-20', dh(200));
    expect(supplierAccountOf(SUPPLIER, recordsOf(shop)).balanceCents).toBe(dh(300));
    expect(supplierAccountOf(SUPPLIER, recordsOf(shop)).purchases[0]).toMatchObject({
      purchaseId: purchase?.id,
      settledCents: dh(500),
      dueCents: dh(300),
    });
    // Another supplier's account is separate.
    expect(supplierAccountOf(crypto.randomUUID(), recordsOf(shop)).balanceCents).toBe(0);
  });

  it('leaves voided purchases and payments out', () => {
    const { shop } = owingShop();
    shop.paySupplier(SUPPLIER, '2026-09-20', dh(200));
    const payment = shop.records.supplierPayments[0];
    if (payment) payment.voidedAt = at('2026-09-21');
    expect(supplierAccountOf(SUPPLIER, recordsOf(shop)).balanceCents).toBe(dh(500));
    const purchase = shop.records.purchases[0];
    if (purchase) purchase.voidedAt = at('2026-09-22');
    expect(supplierAccountOf(SUPPLIER, recordsOf(shop)).balanceCents).toBe(0);
  });

  it('the statement lists the purchase, what was paid with it and the payments, with the balance', () => {
    const { shop } = owingShop();
    shop.paySupplier(SUPPLIER, '2026-09-20', dh(200));
    expect(
      supplierStatementOf(SUPPLIER, recordsOf(shop)).map((line) => [line.kind, line.balanceCents]),
    ).toEqual([
      ['purchase', dh(800)],
      ['paid_at_purchase', dh(500)],
      ['payment', dh(300)],
    ]);
  });
});

describe('paying a supplier (SP3)', () => {
  it('is limited to what is owed, and to a purchase of that supplier', () => {
    const { shop, purchase } = owingShop();
    const payment = (amountCents: number, purchaseId: string | null = null) => ({
      id: crypto.randomUUID(),
      supplierId: SUPPLIER,
      purchaseId,
      amountCents,
    });
    expect(checkSupplierPayment(payment(dh(500)), recordsOf(shop))).toEqual([]);
    expect(checkSupplierPayment(payment(dh(501)), recordsOf(shop))).toEqual([
      { path: ['amountCents'], message: SUPPLIER_PAYMENT_ISSUES.aboveOwed, code: 'custom' },
    ]);
    expect(checkSupplierPayment(payment(dh(100), purchase?.id), recordsOf(shop))).toEqual([]);
    expect(checkSupplierPayment(payment(dh(100), crypto.randomUUID()), recordsOf(shop))).toEqual([
      { path: ['purchaseId'], message: SUPPLIER_PAYMENT_ISSUES.unknownPurchase, code: 'custom' },
    ]);
  });

  it('a payment already recorded is not counted against itself when it is checked again', () => {
    const { shop } = owingShop();
    shop.paySupplier(SUPPLIER, '2026-09-20', dh(500));
    const stored = shop.records.supplierPayments[0];
    if (!stored) throw new Error('a payment');
    expect(checkSupplierPayment(stored, recordsOf(shop))).toEqual([]);
  });

  it('is created or voided, never edited', () => {
    const { shop } = owingShop();
    shop.paySupplier(SUPPLIER, '2026-09-20', dh(100));
    const current = shop.records.supplierPayments[0];
    if (!current) throw new Error('a payment');
    expect(checkSupplierPaymentUnchanged(current, { ...current, note: 'x' })).toEqual([
      { path: ['note'], message: SUPPLIER_PAYMENT_ISSUES.fixed, code: 'custom' },
    ]);
    expect(
      checkSupplierPaymentUnchanged(current, { ...current, voidedAt: at('2026-09-21') }),
    ).toEqual([]);
  });

  it('parses, defaults a cash method, and is dated for the period lock', () => {
    expect(
      newSupplierPaymentSchema.parse({
        supplierId: SUPPLIER,
        amountCents: 100,
        date: '2026-09-20',
      }),
    ).toMatchObject({ purchaseId: null, method: 'cash', note: null });
    const payment = supplierPaymentSchema.parse({
      ...base('2026-09-20'),
      id: crypto.randomUUID(),
      supplierId: SUPPLIER,
      purchaseId: null,
      amountCents: 100,
      date: '2026-09-20',
      method: 'bank',
      note: null,
    });
    expect(periodDatesOf('supplier_payment', payment)).toEqual(['2026-09-20']);
  });
});

describe('the books with supplier debts (SPEC §9, §10)', () => {
  it('the integrity check holds with the debt as a claim, and after each payment', () => {
    const { shop } = owingShop();
    expect(integrityStateOf(shop.records)).toMatchObject({
      cashCents: dh(1000 - 300),
      stockAtCostCents: dh(800),
      supplierPayablesCents: dh(500),
    });
    expect(integrityReportOf(shop.records)).toMatchObject({ ok: true, diffCents: 0 });
    shop.paySupplier(SUPPLIER, '2026-09-20', dh(200));
    expect(integrityStateOf(shop.records)).toMatchObject({
      cashCents: dh(500),
      supplierPayablesCents: dh(300),
    });
    expect(integrityReportOf(shop.records).ok).toBe(true);
    shop.settle('2026-09-30');
    expect(integrityReportOf(shop.records).ok).toBe(true);
  });

  it('the debt comes off the zakat base (SPEC §10)', () => {
    const { shop } = owingShop();
    const names = { fabrics: [], variants: [], customers: [] };
    const supplier = {
      ...base('2026-09-01'),
      id: SUPPLIER,
      name: 'مورد',
      phone: null,
      notes: null,
    };
    const position = zakatPositionOf({ ...shop.records, ...names, suppliers: [supplier] });
    expect(position.supplierDebts).toEqual([
      { supplierId: SUPPLIER, name: 'مورد', amountCents: dh(500) },
    ]);
    shop.paySupplier(SUPPLIER, '2026-09-20', dh(500));
    expect(
      zakatPositionOf({ ...shop.records, ...names, suppliers: [supplier] }).supplierDebts,
    ).toEqual([]);
  });
});
