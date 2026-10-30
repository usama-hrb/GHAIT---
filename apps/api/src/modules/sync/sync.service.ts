import {
  type RecordBase,
  SERVER_DEVICE_ID,
  SYNC_ENTITIES,
  type SyncEntity,
  type SyncOp,
  type SyncOpResult,
  type SyncPullQuery,
  type SyncPullResponse,
  voidPayloadSchema,
} from '@fabric/contracts';
import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import type { z } from 'zod';
import {
  AppHttpException,
  issuesOf,
  requestContext,
  sqlState,
  ValidationFailedException,
} from '../../common/index.js';
import { TransactionHost } from '../../database/index.js';
import { AuditService } from '../audit/index.js';
import { type SyncedRow, type SyncHandler, SyncRegistry, SyncRejection } from './sync.registry.js';
import { SyncRepository } from './sync.repository.js';

type AnyRecord = RecordBase & Record<string, unknown>;
type MutableHandler = Required<SyncHandler>;
type OpOutcome = Omit<SyncOpResult, 'opId' | 'originalStatus'> & {
  status: 'applied' | 'conflict' | 'rejected';
};

/** How far ahead of the server's clock a device's updatedAt may be when it is stored (5 min). */
export const MAX_CLOCK_AHEAD_MS = 5 * 60_000;

/** (updatedAt, deviceId) of `a` is later than `b`'s: last write wins (ADR 0002). */
function isLater(a: RecordBase, b: RecordBase): boolean {
  const difference = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
  return difference !== 0 ? difference > 0 : a.deviceId > b.deviceId;
}

/**
 * A pushed record's updatedAt, at most MAX_CLOCK_AHEAD_MS after the server received it: a device
 * whose clock runs ahead cannot win every later conflict (BUILD_PROMPTS 3.6). The device gets
 * the stored value back on its next pull.
 */
function withinClock(record: AnyRecord, now = Date.now()): AnyRecord {
  const cap = now + MAX_CLOCK_AHEAD_MS;
  return Date.parse(record.updatedAt) > cap
    ? { ...record, updatedAt: new Date(cap).toISOString() }
    : record;
}

/** What an op of this entity carries: its pushSchema when it has one, else its record. */
function pushSchemaOf(entity: SyncEntity): z.ZodType {
  const definition: { schema: z.ZodType; pushSchema?: z.ZodType } = SYNC_ENTITIES[entity];
  return definition.pushSchema ?? definition.schema;
}

const applied = (serverSeq: number): OpOutcome => ({ status: 'applied', serverSeq, error: null });

/**
 * Applies device ops and serves changes (ADR 0002).
 *
 * Mutable entities merge by last write wins on (updatedAt, deviceId), but only when the edits
 * were concurrent: the op names the server_seq it was based on, and a record changed since by
 * another device is a conflict. The losing version is kept in sync_conflict. A device's own
 * consecutive edits never conflict with each other. Voids are final: an upsert never clears
 * voidedAt.
 */
@Injectable()
export class SyncService implements OnModuleInit {
  constructor(
    private readonly registry: SyncRegistry,
    private readonly repository: SyncRepository,
    private readonly audit: AuditService,
    private readonly tx: TransactionHost,
  ) {}

  onModuleInit(): void {
    const conflicts: SyncHandler<'sync_conflict'> = {
      entity: 'sync_conflict',
      pull: (since, limit) => this.repository.pullConflicts(since, limit),
    };
    this.registry.register(conflicts);
  }

  /** Each op in its own transaction, in order; one failing op does not stop the others. */
  async push(ops: readonly SyncOp[]): Promise<SyncOpResult[]> {
    const results: SyncOpResult[] = [];
    for (const op of ops) results.push(await this.pushOne(op));
    return results;
  }

  async pull({ since, limit }: SyncPullQuery): Promise<SyncPullResponse> {
    // Each entity's next `limit + 1` rows, merged: enough to fill the page and know if more remain.
    const batches = await Promise.all(
      this.registry.all().map(async (handler) =>
        (await handler.pull(since, limit + 1)).map((row) => ({
          entity: handler.entity,
          serverSeq: row.serverSeq,
          record: row.record,
        })),
      ),
    );
    const merged = batches.flat().sort((a, b) => a.serverSeq - b.serverSeq);
    const changes = merged.slice(0, limit);
    return {
      changes,
      nextSince: changes.at(-1)?.serverSeq ?? since,
      hasMore: merged.length > limit,
      epoch: await this.repository.epoch(),
    };
  }

  /**
   * A change made through the REST API rather than pushed by a device: validated and audited
   * the same way, without conflict detection (it is made on the current version).
   */
  async saveDirect(entity: SyncEntity, record: AnyRecord): Promise<SyncedRow<AnyRecord>> {
    const handler = this.mutableHandler(entity);
    const parsed = SYNC_ENTITIES[entity].schema.safeParse(record);
    if (!parsed.success) throw new ValidationFailedException(parsed.error);
    const current = await handler.find(record.id);
    const written = await handler.write(parsed.data);
    await this.audit.record({
      entity,
      entityId: record.id,
      action: current ? 'update' : 'create',
      before: current?.record ?? null,
      after: written.record,
    });
    return written;
  }

  async voidDirect(entity: SyncEntity, id: string, reason: string): Promise<SyncedRow<AnyRecord>> {
    const handler = this.mutableHandler(entity);
    const current = await handler.find(id);
    if (!current)
      throw new AppHttpException('not_found', `No ${entity} ${id}`, HttpStatus.NOT_FOUND);
    if ((current.record as AnyRecord).voidedAt !== null) return current;
    const written = await handler.markVoided(
      id,
      new Date(),
      requestContext()?.deviceId ?? SERVER_DEVICE_ID,
    );
    await this.audit.record({
      entity,
      entityId: id,
      action: 'void',
      before: current.record,
      after: written.record,
      reason,
    });
    return written;
  }

  /** Looks up a record of any registered entity (REST reads). */
  async find(entity: SyncEntity, id: string): Promise<SyncedRow<AnyRecord> | undefined> {
    return await this.mutableHandler(entity).find(id);
  }

  private mutableHandler(entity: SyncEntity): MutableHandler {
    const handler = this.registry.get(entity);
    if (!handler?.find || !handler.write || !handler.markVoided) {
      throw new Error(`No mutable sync handler registered for ${entity}`);
    }
    return handler as MutableHandler;
  }

  private pushOne(op: SyncOp): Promise<SyncOpResult> {
    return this.tx.run(async () => {
      const previous = await this.repository.findOp(op.opId);
      if (previous) {
        return {
          opId: op.opId,
          status: 'duplicate',
          serverSeq: previous.resultServerSeq,
          error: previous.error as SyncOpResult['error'],
          originalStatus: previous.status,
        };
      }
      let outcome: OpOutcome;
      try {
        // A savepoint: a failing op leaves the transaction usable to record its rejection.
        outcome = await this.tx.savepoint(() => this.apply(op));
      } catch (error) {
        outcome = this.rejection(error);
      }
      await this.repository.recordOp(op, outcome, requestContext()?.actorId ?? null);
      return { opId: op.opId, ...outcome };
    });
  }

  private rejection(error: unknown): OpOutcome {
    if (error instanceof SyncRejection) {
      return {
        status: 'rejected',
        serverSeq: null,
        error: {
          code: error.code,
          message: error.message,
          ...(error.issues ? { issues: error.issues } : {}),
        },
      };
    }
    // A reference to a record the server does not have (e.g. its own op was rejected), or a
    // unique value already taken (a roll code): deterministic, so rejected rather than retried.
    const state = sqlState(error);
    if (state === '23503' || state === '23505') {
      return {
        status: 'rejected',
        serverSeq: null,
        error: {
          code: 'conflict',
          message:
            state === '23503'
              ? 'Refers to a record the server does not have'
              : 'A value that must be unique is already taken',
        },
      };
    }
    throw error;
  }

  private apply(op: SyncOp): Promise<OpOutcome> {
    const merge = SYNC_ENTITIES[op.entity].merge;
    const handler = this.registry.get(op.entity);
    if (op.kind === 'append') {
      if (merge !== 'append_only' || !handler?.append) {
        return Promise.reject(new SyncRejection('bad_request', `${op.entity} is not append-only`));
      }
      return this.append(op, handler);
    }
    if (merge !== 'mutable' || !handler?.find || !handler.write || !handler.markVoided) {
      return Promise.reject(
        new SyncRejection('bad_request', `${op.entity} does not accept ${op.kind} ops`),
      );
    }
    return op.kind === 'upsert'
      ? this.upsert(op, handler as MutableHandler)
      : this.void(op, handler as MutableHandler);
  }

  /** Append-only: a record is inserted once and never overwritten (ADR 0002). */
  private async append(op: SyncOp, handler: SyncHandler): Promise<OpOutcome> {
    const parsed = pushSchemaOf(op.entity).safeParse(op.payload);
    if (!parsed.success) {
      throw new SyncRejection(
        'validation_failed',
        'Invalid payload',
        issuesOf(parsed.error, ['payload']),
      );
    }
    const existing = await handler.find?.(op.entityId);
    if (existing) return applied(existing.serverSeq);
    const written = await this.appendAndAudit(op.entity, handler, parsed.data, {
      entityId: op.entityId,
      deviceId: op.deviceId,
    });
    return applied(written.serverSeq);
  }

  /**
   * An append made through the REST API: the same validation, entity rules and audit as a
   * pushed op. A record that exists already is a conflict here (a device op would be a no-op).
   */
  async appendDirect(
    entity: SyncEntity,
    entityId: string,
    payload: unknown,
  ): Promise<SyncedRow<AnyRecord>> {
    const handler = this.registry.get(entity);
    if (SYNC_ENTITIES[entity].merge !== 'append_only' || !handler?.append) {
      throw new Error(`No append-only sync handler registered for ${entity}`);
    }
    const parsed = pushSchemaOf(entity).safeParse(payload);
    if (!parsed.success) throw new ValidationFailedException(parsed.error);
    if (await handler.find?.(entityId)) {
      throw new AppHttpException(
        'conflict',
        `${entity} ${entityId} exists already`,
        HttpStatus.CONFLICT,
      );
    }
    try {
      return await this.appendAndAudit(entity, handler, parsed.data, {
        entityId,
        deviceId: requestContext()?.deviceId ?? SERVER_DEVICE_ID,
      });
    } catch (error) {
      if (error instanceof SyncRejection) {
        throw new AppHttpException(
          error.code === 'validation_failed' ? 'validation_failed' : error.code,
          error.message,
          error.code === 'conflict' ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  private async appendAndAudit(
    entity: SyncEntity,
    handler: SyncHandler,
    payload: unknown,
    context: { entityId: string; deviceId: string },
  ): Promise<SyncedRow<AnyRecord>> {
    const written = await (handler.append as NonNullable<SyncHandler['append']>)(
      payload as never,
      context,
    );
    await this.audit.record({
      entity,
      entityId: context.entityId,
      action: 'create',
      before: null,
      after: payload,
      deviceId: context.deviceId,
    });
    return written;
  }

  private async upsert(op: SyncOp, handler: MutableHandler): Promise<OpOutcome> {
    const parsed = SYNC_ENTITIES[op.entity].schema.safeParse(op.payload);
    if (!parsed.success) {
      throw new SyncRejection(
        'validation_failed',
        'Invalid record',
        issuesOf(parsed.error, ['payload']),
      );
    }
    const record = withinClock(parsed.data);
    if (record.id !== op.entityId || record.deviceId !== op.deviceId) {
      throw new SyncRejection('bad_request', 'The record does not match the op (id or device)');
    }

    const current = await handler.find(op.entityId);
    if (!current) {
      const written = await handler.write(record as never);
      await this.audit.record({
        entity: op.entity,
        entityId: op.entityId,
        action: 'create',
        before: null,
        after: written.record,
        deviceId: op.deviceId,
      });
      return applied(written.serverSeq);
    }

    const currentRecord = current.record as AnyRecord;
    const concurrent =
      current.serverSeq !== op.baseServerSeq && currentRecord.deviceId !== op.deviceId;
    if (concurrent && !isLater(record, currentRecord)) {
      await this.repository.recordConflict({
        op,
        winner: 'server',
        loser: record,
        winnerRecord: currentRecord,
      });
      return { status: 'conflict', serverSeq: current.serverSeq, error: null };
    }
    const written = await handler.write(record as never);
    if (concurrent) {
      await this.repository.recordConflict({
        op,
        winner: 'incoming',
        loser: currentRecord,
        winnerRecord: written.record,
      });
    }
    await this.audit.record({
      entity: op.entity,
      entityId: op.entityId,
      action: 'update',
      before: currentRecord,
      after: written.record,
      deviceId: op.deviceId,
    });
    return applied(written.serverSeq);
  }

  private async void(op: SyncOp, handler: MutableHandler): Promise<OpOutcome> {
    const payload = voidPayloadSchema.safeParse(op.payload);
    if (!payload.success) {
      throw new SyncRejection(
        'validation_failed',
        'A void needs a reason',
        issuesOf(payload.error, ['payload']),
      );
    }
    const current = await handler.find(op.entityId);
    if (!current) throw new SyncRejection('not_found', `No ${op.entity} ${op.entityId}`);
    // Already voided (here or on another device): nothing changes.
    if ((current.record as AnyRecord).voidedAt !== null) return applied(current.serverSeq);
    const written = await handler.markVoided(op.entityId, new Date(op.clientTs), op.deviceId);
    await this.audit.record({
      entity: op.entity,
      entityId: op.entityId,
      action: 'void',
      before: current.record,
      after: written.record,
      reason: payload.data.reason,
      deviceId: op.deviceId,
    });
    return applied(written.serverSeq);
  }
}
