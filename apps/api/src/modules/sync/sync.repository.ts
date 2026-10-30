import type { SyncOp, SyncOpResult } from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema, TransactionHost } from '../../database/index.js';

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
}
