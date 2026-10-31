import {
  type AuditAction,
  type AuditActor,
  type AuditListQuery,
  SHOP_TIME_ZONE,
} from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, lt, type SQL, sql } from 'drizzle-orm';
import { schema, TransactionHost } from '../../database/index.js';

export type AuditRow = typeof schema.auditLog.$inferSelect & { actorName: string | null };

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

  /** Newest first, with the actor's name; one extra row tells whether there is a next page. */
  async list(query: AuditListQuery): Promise<AuditRow[]> {
    const { auditLog, appUser } = schema;
    // The day an entry was made, in the shop's time zone (the dates the owner filters by).
    const day = sql`(${auditLog.at} AT TIME ZONE ${SHOP_TIME_ZONE})::date`;
    const filters: SQL[] = [];
    if (query.entity !== undefined) filters.push(eq(auditLog.entity, query.entity));
    if (query.entityId !== undefined) filters.push(eq(auditLog.entityId, query.entityId));
    if (query.actorId !== undefined) filters.push(eq(auditLog.actorId, query.actorId));
    if (query.from !== undefined) filters.push(sql`${day} >= ${query.from}::date`);
    if (query.to !== undefined) filters.push(sql`${day} <= ${query.to}::date`);
    if (query.cursor !== undefined) filters.push(lt(auditLog.serverSeq, query.cursor));
    const rows = await this.tx.db
      .select({ entry: auditLog, actorName: appUser.displayName })
      .from(auditLog)
      .leftJoin(appUser, eq(appUser.id, auditLog.actorId))
      .where(and(...filters))
      .orderBy(desc(auditLog.serverSeq))
      .limit(query.limit + 1);
    return rows.map(({ entry, actorName }) => ({ ...entry, actorName }));
  }

  /** The accounts that can appear in the log. */
  async actors(): Promise<AuditActor[]> {
    const { appUser } = schema;
    return this.tx.db
      .select({ id: appUser.id, displayName: appUser.displayName, role: appUser.role })
      .from(appUser)
      .orderBy(asc(appUser.createdAt));
  }
}
