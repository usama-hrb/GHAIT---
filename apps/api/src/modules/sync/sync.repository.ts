import type { SyncConflict, SyncOp, SyncOpResult } from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { asc, desc, eq, gt } from 'drizzle-orm';
import { baseOf, schema, TransactionHost } from '../../database/index.js';
import type { SyncedRow } from './sync.registry.js';

export type SyncOpRow = typeof schema.syncOp.$inferSelect;
type StoredStatus = SyncOpRow['status'];

@Injectable()
export class SyncRepository {
  constructor(private readonly tx: TransactionHost) {}

  async findOp(opId: string): Promise<SyncOpRow | undefined> {
    const [row] = await this.tx.db.select().from(schema.syncOp).where(eq(schema.syncOp.id, opId));
    return row;
  }

  async recordOp(
    op: SyncOp,
    result: { status: StoredStatus; serverSeq: number | null; error: SyncOpResult['error'] },
    actorId: string | null,
  ): Promise<void> {
    await this.tx.db.insert(schema.syncOp).values({
      id: op.opId,
      entity: op.entity,
      entityId: op.entityId,
      kind: op.kind,
      status: result.status,
      resultServerSeq: result.serverSeq,
      error: result.error,
      actorId,
      deviceId: op.deviceId,
    });
  }

  async recordConflict(conflict: {
    op: SyncOp;
    winner: 'incoming' | 'server';
    loser: unknown;
    winnerRecord: unknown;
  }): Promise<void> {
    await this.tx.db.insert(schema.syncConflict).values({
      opId: conflict.op.opId,
      entity: conflict.op.entity,
      entityId: conflict.op.entityId,
      winner: conflict.winner,
      loser: conflict.loser,
      winnerRecord: conflict.winnerRecord,
      deviceId: conflict.op.deviceId,
    });
  }

  async pullConflicts(since: number, limit: number): Promise<SyncedRow<SyncConflict>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.syncConflict)
      .where(gt(schema.syncConflict.serverSeq, since))
      .orderBy(asc(schema.syncConflict.serverSeq))
      .limit(limit);
    return rows.map((row) => ({
      serverSeq: row.serverSeq,
      record: {
        ...baseOf(row),
        opId: row.opId,
        entity: row.entity,
        entityId: row.entityId,
        winner: row.winner === 'incoming' ? 'incoming' : 'server',
        loser: row.loser,
        winnerRecord: row.winnerRecord,
      },
    }));
  }

  /** The current epoch: the newest server_instance (migration 0011 adds the first). */
  async epoch(): Promise<string> {
    const [row] = await this.tx.db
      .select({ id: schema.serverInstance.id })
      .from(schema.serverInstance)
      .orderBy(desc(schema.serverInstance.serverSeq))
      .limit(1);
    if (!row) throw new Error('server_instance is empty: run the migrations');
    return row.id;
  }
}
