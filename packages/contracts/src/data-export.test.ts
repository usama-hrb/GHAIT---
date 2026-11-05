import { describe, expect, it } from 'vitest';
import { EXPORT_ENTITIES, upgradeLegacyExport } from './index.js';

const legacyLine = {
  id: crypto.randomUUID(),
  saleId: crypto.randomUUID(),
  rollId: crypto.randomUUID(),
  soldCm: 275,
  refPricePerMeterCents: 2000,
  minPricePerMeterCents: 1700,
  actualPricePerMeterCents: 1800,
  wholePiece: false,
  lineTotalCents: 4950,
  createdAt: '2026-10-01T09:00:00.000Z',
};

describe('exports from before product batches (ADR 0012)', () => {
  it('gives a sale line its batch (the roll), unit, quantity and prices', () => {
    const upgraded = upgradeLegacyExport({ records: { sale_line: [legacyLine], sale: [] } }) as {
      records: { sale_line: Record<string, unknown>[]; sale: unknown[] };
    };
    expect(upgraded.records.sale).toEqual([]);
    expect(upgraded.records.sale_line).toEqual([
      {
        id: legacyLine.id,
        saleId: legacyLine.saleId,
        batchId: legacyLine.rollId,
        unit: 'meter',
        quantity: 275,
        refPriceCents: 2000,
        minPriceCents: 1700,
        actualPriceCents: 1800,
        minOverrideBy: null,
        wholePiece: false,
        lineTotalCents: 4950,
        createdAt: legacyLine.createdAt,
      },
    ]);
  });

  it('leaves a current export, and anything that is not an export, as it is', () => {
    const current = { records: { sale_line: [{ id: 'x', batchId: 'b', quantity: 1 }] } };
    expect(upgradeLegacyExport(current)).toEqual(current);
    expect(upgradeLegacyExport(null)).toBeNull();
    expect(upgradeLegacyExport('nope')).toBe('nope');
    expect(upgradeLegacyExport({ records: {} })).toEqual({ records: {} });
    // Every entity a current export lists is still there to insert.
    expect(EXPORT_ENTITIES).toContain('product_batch');
    // Employees and their rates are exported, and loaded before the expenses that pay them.
    const order = (entity: (typeof EXPORT_ENTITIES)[number]) => EXPORT_ENTITIES.indexOf(entity);
    expect(order('employee')).toBeLessThan(order('employee_salary'));
    expect(order('employee_salary')).toBeLessThan(order('expense'));
  });
});
