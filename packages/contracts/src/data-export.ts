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
  'purchase',
  'roll',
  'stock_move',
  'customer',
  'sale',
  'sale_line',
  'payment',
  'payment_allocation',
  'sale_void',
  'write_off',
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
