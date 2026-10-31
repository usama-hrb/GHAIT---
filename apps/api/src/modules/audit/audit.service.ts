import {
  type AuditAction,
  type AuditActor,
  type AuditEntry,
  type AuditListQuery,
  type AuditListResponse,
  SERVER_DEVICE_ID,
} from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { requestContext, requestIdOf } from '../../common/index.js';
import { AuditRepository, type AuditRow } from './audit.repository.js';
import { AuditScope } from './audit.scope.js';

export interface AuditRecord {
  entity: string;
  entityId: string;
  action: AuditAction;
  /** null when created. Snapshots must never hold secrets (password hashes, tokens). */
  before: unknown;
  /** null when nothing remains to show. */
  after: unknown;
  /** Defaults to the request's x-audit-reason. */
  reason?: string | null;
  /** Defaults to the request's x-device-id (a sync op names its own device). */
  deviceId?: string;
}

function toEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    at: row.at.toISOString(),
    actorId: row.actorId,
    actorName: row.actorName,
    entity: row.entity,
    entityId: row.entityId,
    action: row.action,
    before: row.before ?? null,
    after: row.after ?? null,
    reason: row.reason,
    requestId: row.requestId,
  };
}

@Injectable()
export class AuditService {
  constructor(
    private readonly repository: AuditRepository,
    private readonly scope: AuditScope,
  ) {}

  /**
   * Writes one audit entry in the current transaction (CLAUDE.md: every change or void).
   * Actor, device and request id come from the request; outside one (CLI) the actor is null.
   */
  async record(entry: AuditRecord): Promise<void> {
    const context = requestContext();
    await this.repository.insert({
      entity: entry.entity,
      entityId: entry.entityId,
      action: entry.action,
      before: entry.before ?? null,
      after: entry.after ?? null,
      reason: entry.reason ?? context?.reason ?? null,
      actorId: context?.actorId ?? null,
      requestId: context ? (requestIdOf(context.request) ?? null) : null,
      deviceId: entry.deviceId ?? context?.deviceId ?? SERVER_DEVICE_ID,
    });
    this.scope.recorded();
  }

  actors(): Promise<AuditActor[]> {
    return this.repository.actors();
  }

  async list(query: AuditListQuery): Promise<AuditListResponse> {
    const rows = await this.repository.list(query);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toEntry),
      nextCursor: rows.length > query.limit && last ? last.serverSeq : null,
    };
  }
}
