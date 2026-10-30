import type { AuditAction, AuditListQuery } from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import { schema, TransactionHost } from '../../database/index.js';

export type AuditRow = typeof schema.auditLog.$inferSelect;

export interface NewAuditRow {
  actorId: string | null;
  entity: string;
  entityId: string;
  action: AuditAction;
  before: unknown;
  after: unknown;
  reason: string | null;
  requestId: string | null;
  deviceId: string;
}

@Injectable()
export class AuditRepository {
  constructor(private readonly tx: TransactionHost) {}

  async insert(row: NewAuditRow): Promise<void> {
    await this.tx.db.insert(schema.auditLog).values(row);
  }

  /** Newest first; one extra row tells whether there is a next page. */
  list(query: AuditListQuery): Promise<AuditRow[]> {
    const { auditLog } = schema;
    const filters: SQL[] = [];
    if (query.entity !== undefined) filters.push(eq(auditLog.entity, query.entity));
    if (query.entityId !== undefined) filters.push(eq(auditLog.entityId, query.entityId));
    if (query.cursor !== undefined) filters.push(lt(auditLog.serverSeq, query.cursor));
    return this.tx.db
      .select()
      .from(auditLog)
      .where(and(...filters))
      .orderBy(desc(auditLog.serverSeq))
      .limit(query.limit + 1);
  }
}
