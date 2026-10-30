import { z } from 'zod';
import { fabricSchema, recordBaseSchema, supplierSchema, variantSchema } from './catalog.js';
import { deviceIdSchema, idSchema, isoDateSchema, timestampSchema } from './common.js';
import {
  customerSchema,
  paymentAllocationSchema,
  paymentSchema,
  writeOffSchema,
} from './customers.js';
import { errorCodeSchema, validationIssueSchema } from './errors.js';
import {
  purchaseAggregateSchema,
  purchaseSchema,
  rollSchema,
  stockMoveSchema,
} from './purchasing.js';
import { creditApplicationSchema, paymentAggregateSchema } from './receivables.js';
import {
  saleAggregateSchema,
  saleLineSchema,
  saleSchema,
  saleVoidAggregateSchema,
  saleVoidSchema,
} from './sales.js';

/**
 * Every entity the devices sync (ADR 0002). Each slice adds its entities here, with how the
 * server merges them:
 * - mutable: upsert and void ops, last write wins on (updatedAt, deviceId);
 * - append_only: append ops, never overwritten (stock_move, payment…);
 * - pull_only: devices receive it, but change it through the API (settings, for now).
 * `schema` is the record as stored and pulled; `pushSchema`, when given, is an op's payload.
 */
/**
 * The losing side of a last-write-wins conflict (ADR 0002), kept on the server and pulled by
 * every device for the read-only conflict screen (BUILD_PROMPTS 3.6).
 */
export const syncConflictSchema = recordBaseSchema.extend({
  opId: idSchema,
  entity: z.string(),
  entityId: idSchema,
  /** `incoming`: the pushed change won; `server`: the version already there won. */
  winner: z.enum(['incoming', 'server']),
  loser: z.unknown(),
  winnerRecord: z.unknown(),
});
export type SyncConflict = z.output<typeof syncConflictSchema>;

export const SYNC_ENTITIES = {
  fabric: { merge: 'mutable', schema: fabricSchema },
  variant: { merge: 'mutable', schema: variantSchema },
  supplier: { merge: 'mutable', schema: supplierSchema },
  /** A purchase op carries its rolls and moves (purchaseAggregateSchema), applied atomically. */
  purchase: { merge: 'append_only', schema: purchaseSchema, pushSchema: purchaseAggregateSchema },
  /** Only its remnant mark changes after the purchase (checkRollUpdate). */
  roll: { merge: 'mutable', schema: rollSchema },
  /** Losses, stocktake counts and measurements (checkStockMove); never overwritten. */
  stock_move: { merge: 'append_only', schema: stockMoveSchema },
  customer: { merge: 'mutable', schema: customerSchema },
  /** A sale op carries its lines, moves and the payment made there (checkSaleAggregate). */
  sale: { merge: 'append_only', schema: saleSchema, pushSchema: saleAggregateSchema },
  /** Lines arrive inside their sale. */
  sale_line: { merge: 'pull_only', schema: saleLineSchema },
  /** A customer's payment or refund with its allocations (checkPaymentAggregate); a payment at the counter comes inside its sale. */
  payment: { merge: 'append_only', schema: paymentSchema, pushSchema: paymentAggregateSchema },
  /** A credit applied to unpaid invoices (checkAllocations). */
  payment_allocation: {
    merge: 'append_only',
    schema: paymentAllocationSchema,
    pushSchema: creditApplicationSchema,
  },
  /** A bad debt (checkWriteOff). */
  write_off: { merge: 'append_only', schema: writeOffSchema },
  /** A void op carries the reversals and the refund (checkSaleVoid); the sale gets voidedAt. */
  sale_void: { merge: 'append_only', schema: saleVoidSchema, pushSchema: saleVoidAggregateSchema },
  sync_conflict: { merge: 'pull_only', schema: syncConflictSchema },
  setting: {
    merge: 'pull_only',
    schema: recordBaseSchema.extend({
      // Any key: a device on an older version must not choke on a newer setting.
      key: z.string(),
      value: z.unknown(),
      effectiveFrom: isoDateSchema.nullable(),
    }),
  },
} as const satisfies Record<
  string,
  { merge: 'mutable' | 'append_only' | 'pull_only'; schema: z.ZodType; pushSchema?: z.ZodType }
>;

export type SyncEntity = keyof typeof SYNC_ENTITIES;
export type SyncRecord<E extends SyncEntity> = z.output<(typeof SYNC_ENTITIES)[E]['schema']>;
/** An op's payload for an entity: its pushSchema when it has one, else its record. */
export type SyncPushPayload<E extends SyncEntity> = (typeof SYNC_ENTITIES)[E] extends {
  pushSchema: infer S extends z.ZodType;
}
  ? z.output<S>
  : SyncRecord<E>;
export const syncEntitySchema = z.enum(Object.keys(SYNC_ENTITIES) as [SyncEntity, ...SyncEntity[]]);
export type SyncedSetting = SyncRecord<'setting'>;

export const SYNC_OP_KINDS = ['upsert', 'void', 'append'] as const;

/**
 * One change made on a device, queued in its outbox and pushed later.
 * - upsert / append: `payload` is the whole record (the entity's schema).
 * - void: `payload` is `{ reason }`; the record keeps its data and gets voidedAt = clientTs.
 */
export const syncOpSchema = z.object({
  /** Idempotency key: pushing the same op again returns the same result. */
  opId: idSchema,
  entity: syncEntitySchema,
  entityId: idSchema,
  kind: z.enum(SYNC_OP_KINDS),
  payload: z.unknown(),
  deviceId: deviceIdSchema,
  clientTs: timestampSchema,
  /**
   * server_seq of the version the change was made on (null: a new record). If the record has
   * changed on another device since, the server treats the op as a conflict.
   */
  baseServerSeq: z.int().positive().nullable(),
});
export type SyncOp = z.infer<typeof syncOpSchema>;

export const voidPayloadSchema = z.object({ reason: z.string().trim().min(1).max(500) });

export const SYNC_PUSH_MAX_OPS = 200;
export const syncPushRequestSchema = z.object({
  /** Applied in order, each in its own transaction. */
  ops: z.array(syncOpSchema).min(1).max(SYNC_PUSH_MAX_OPS),
});
export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>;

/**
 * - applied: the change is on the server (it may have won a conflict; the loser is logged);
 * - duplicate: this opId was pushed before; same serverSeq and error as the first time;
 * - conflict: another device's newer change won; pull to get it (this one is logged);
 * - rejected: invalid; the device keeps it visible to the user, it is never retried as is.
 */
export const SYNC_OP_STATUSES = ['applied', 'duplicate', 'conflict', 'rejected'] as const;
export const syncOpResultSchema = z.object({
  opId: idSchema,
  status: z.enum(SYNC_OP_STATUSES),
  /** For applied, duplicate and conflict: server_seq of the record's version now on the server. */
  serverSeq: z.int().positive().nullable(),
  error: z
    .object({
      code: errorCodeSchema,
      message: z.string(),
      issues: z.array(validationIssueSchema).optional(),
    })
    .nullable(),
  /** For duplicate: what the first push answered. */
  originalStatus: z.enum(SYNC_OP_STATUSES).optional(),
});
export type SyncOpResult = z.infer<typeof syncOpResultSchema>;

export const syncPushResponseSchema = z.object({ results: z.array(syncOpResultSchema) });
export type SyncPushResponse = z.infer<typeof syncPushResponseSchema>;

export const SYNC_PULL_MAX_LIMIT = 500;
export const syncPullQuerySchema = z.object({
  /** Last server_seq this device has; 0 for everything. */
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(SYNC_PULL_MAX_LIMIT).default(200),
});
export type SyncPullQuery = z.infer<typeof syncPullQuerySchema>;

export const syncChangeSchema = z.object({
  entity: syncEntitySchema,
  serverSeq: z.int().positive(),
  /** The entity's record schema; parse it with SYNC_ENTITIES[entity].schema. */
  record: z.unknown(),
});
export type SyncChange = z.infer<typeof syncChangeSchema>;

export const syncPullResponseSchema = z.object({
  /** Ordered by serverSeq, voided records included. */
  changes: z.array(syncChangeSchema),
  /** Pass as `since` next time. */
  nextSince: z.int().min(0),
  hasMore: z.boolean(),
  /**
   * The server's data set. It changes when the database is restored from a backup or an export:
   * a device that sees a new epoch pulls everything again from 0 (its cursor is meaningless now).
   */
  epoch: idSchema,
});
export type SyncPullResponse = z.infer<typeof syncPullResponseSchema>;
