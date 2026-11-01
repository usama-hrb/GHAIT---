import type {
  ErrorCode,
  SyncEntity,
  SyncPushPayload,
  SyncRecord,
  ValidationIssue,
} from '@fabric/contracts';
import { Injectable } from '@nestjs/common';

/** A record with the server_seq of its current version. */
export interface SyncedRow<R> {
  record: R;
  serverSeq: number;
}

/**
 * Data access for one synced entity, registered by the module that owns it (ADR 0002: each slice
 * registers its entities). Merge rules, validation and audit stay in SyncService.
 */
export interface SyncHandler<E extends SyncEntity = SyncEntity> {
  readonly entity: E;
  /** Rows with server_seq > since, oldest first, at most `limit`; voided rows included. */
  pull(since: number, limit: number): Promise<SyncedRow<SyncRecord<E>>[]>;
  /** For pushed entities. */
  find?(id: string): Promise<SyncedRow<SyncRecord<E>> | undefined>;
  /** Mutable entities: insert, or update every field but createdAt and voidedAt. */
  write?(record: SyncRecord<E>): Promise<SyncedRow<SyncRecord<E>>>;
  /** Mutable entities: sets voidedAt (and updatedAt) to `at`. */
  markVoided?(id: string, at: Date, deviceId: string): Promise<SyncedRow<SyncRecord<E>>>;
  /**
   * Append-only entities: inserts what the op carries (validated against pushSchema), in the
   * op's transaction. Throw SyncRejection for a payload the entity's rules refuse.
   */
  append?(
    payload: SyncPushPayload<E>,
    context: { entityId: string; deviceId: string },
  ): Promise<SyncedRow<SyncRecord<E>>>;
  /**
   * The record as the audit log and the conflict log keep it, when it should not keep all of it
   * (a photo's image would add ~100 KB to every entry). Default: the record itself.
   */
  auditView?(record: SyncRecord<E>): unknown;
  /**
   * The dates a change is accounted on, when they are not all in the payload (a sale void is
   * dated by its sale too). Default: periodDatesOf (@fabric/contracts).
   */
  periodDates?(payload: SyncPushPayload<E>): Promise<(string | null)[]>;
}

/**
 * Refuses a change dated inside a settled period (BUILD_PROMPTS 4.3), in the change's
 * transaction. Registered by the settlements module.
 */
export interface PeriodGuard {
  /** Throws SyncRejection('period_locked') when one of the dates is locked. */
  assertOpen(dates: readonly (string | null)[]): Promise<void>;
}

/** A pushed op the server refuses; recorded as `rejected`, so a replay answers the same. */
export class SyncRejection extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly issues?: ValidationIssue[],
  ) {
    super(message);
  }
}

@Injectable()
export class SyncRegistry {
  private readonly handlers = new Map<SyncEntity, SyncHandler>();
  private guard: PeriodGuard | undefined;

  setPeriodGuard(guard: PeriodGuard): void {
    if (this.guard) throw new Error('Two period guards registered');
    this.guard = guard;
  }

  periodGuard(): PeriodGuard | undefined {
    return this.guard;
  }

  register(handler: SyncHandler): void {
    if (this.handlers.has(handler.entity)) {
      throw new Error(`Two sync handlers registered for ${handler.entity}`);
    }
    this.handlers.set(handler.entity, handler);
  }

  get(entity: SyncEntity): SyncHandler | undefined {
    return this.handlers.get(entity);
  }

  all(): SyncHandler[] {
    return [...this.handlers.values()];
  }
}
