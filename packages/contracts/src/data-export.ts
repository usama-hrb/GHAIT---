import { z } from 'zod';
import { deviceCodeSchema } from './purchasing.js';
import { SYNC_ENTITIES, type SyncEntity } from './sync.js';
import { timestampSchema } from './common.js';

/**
 * Entities in the order an import inserts them (references first). Every synced entity is in
 * the export: each device holds the whole shop, so a device's export is a full copy too.
 */
export const EXPORT_ENTITIES = [
  'setting',
  'supplier',
  'fabric',
  'variant',
  'product',
  'photo',
  'purchase',
  'roll',
  'stock_move',
  'product_batch',
  'product_stock_move',
  'supplier_payment',
  'customer',
  'sale',
  'sale_line',
  'payment',
  'payment_allocation',
  'sale_void',
  'sale_return',
  'write_off',
  // Employees come before the expenses that pay them (expense.employee_id is a foreign key).
  'employee',
  'employee_salary',
  'recurring_expense',
  'expense',
  'cash_adjustment',
  'partner',
  'profit_split_rule',
  'settlement',
  'settlement_share',
  'locked_cost',
  'capital_move',
  'zakat_report',
  'partner_draw',
  'sync_conflict',
] as const satisfies readonly SyncEntity[];

/**
 * A full export of the shop's data (BUILD_PROMPTS 3.6), from the settings screen (a device) or
 * `make export` (the server). `make import` loads one into an empty database
 * (docs/runbooks/backup.md). Records are as synced (no server_seq: the import numbers them).
 */
export const dataExportSchema = z.object({
  format: z.literal('fabric-shop-export'),
  version: z.literal(1),
  exportedAt: timestampSchema,
  source: z.enum(['server', 'device']),
  /** The server's devices and their codes (a device export has none; codes come from rolls). */
  devices: z.array(z.object({ key: z.string(), code: deviceCodeSchema })).default([]),
  records: z.object(
    Object.fromEntries(
      EXPORT_ENTITIES.map((entity) => [entity, z.array(SYNC_ENTITIES[entity].schema).default([])]),
    ) as {
      [E in (typeof EXPORT_ENTITIES)[number]]: z.ZodDefault<
        z.ZodArray<(typeof SYNC_ENTITIES)[E]['schema']>
      >;
    },
  ),
});
export type DataExport = z.output<typeof dataExportSchema>;
export type DataExportInput = z.input<typeof dataExportSchema>;

type Loose = Record<string, unknown>;
const isRecord = (value: unknown): value is Loose =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * An export written before product batches (ADR 0012) has its sale lines on rolls. This gives
 * them the shape they have now: the roll is the batch (they share an id), the length sold is the
 * quantity in meters and the per-meter prices are the prices. Anything else passes through; the
 * rolls and moves of an old export become batches when it is imported (the stock backfill).
 */
export function upgradeLegacyExport(file: unknown): unknown {
  if (!isRecord(file) || !isRecord(file.records)) return file;
  const lines = file.records.sale_line;
  if (!Array.isArray(lines)) return file;
  const upgraded = lines.map((line: unknown) => {
    if (!isRecord(line) || line.batchId !== undefined || line.rollId === undefined) return line;
    const {
      rollId,
      soldCm,
      refPricePerMeterCents,
      minPricePerMeterCents,
      actualPricePerMeterCents,
      ...rest
    } = line;
    return {
      ...rest,
      batchId: rollId,
      unit: 'meter',
      quantity: soldCm,
      refPriceCents: refPricePerMeterCents,
      minPriceCents: minPricePerMeterCents,
      actualPriceCents: actualPricePerMeterCents,
      minOverrideBy: null,
    };
  });
  return { ...file, records: { ...file.records, sale_line: upgraded } };
}
