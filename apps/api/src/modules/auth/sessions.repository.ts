import { Injectable } from '@nestjs/common';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { schema, TransactionHost } from '../../database/index.js';

export type SessionRow = typeof schema.authSession.$inferSelect;

@Injectable()
export class SessionsRepository {
  constructor(private readonly tx: TransactionHost) {}

  async insert(session: {
    userId: string;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
    deviceId: string;
  }): Promise<SessionRow> {
    const [row] = await this.tx.db.insert(schema.authSession).values(session).returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  }

  /** Locks the row: two refreshes with the same token cannot both rotate it. */
  async findByTokenHashForUpdate(tokenHash: string): Promise<SessionRow | undefined> {
    const [row] = await this.tx.db
      .select()
      .from(schema.authSession)
      .where(eq(schema.authSession.tokenHash, tokenHash))
      .for('update');
    return row;
  }

  async markRotated(id: string, at: Date): Promise<void> {
    await this.tx.db
      .update(schema.authSession)
      .set({ rotatedAt: at, updatedAt: at })
      .where(eq(schema.authSession.id, id));
  }

  /** Revokes every live session of a family (but `except`); returns how many. */
  async revokeFamily(
    familyId: string,
    at: Date,
    { except }: { except?: string } = {},
  ): Promise<number> {
    const rows = await this.tx.db
      .update(schema.authSession)
      .set({ revokedAt: at, updatedAt: at })
      .where(
        and(
          eq(schema.authSession.familyId, familyId),
          isNull(schema.authSession.revokedAt),
          except === undefined ? undefined : ne(schema.authSession.id, except),
        ),
      )
      .returning({ id: schema.authSession.id });
    return rows.length;
  }

  async revokeAllOfUser(userId: string, at: Date): Promise<number> {
    const rows = await this.tx.db
      .update(schema.authSession)
      .set({ revokedAt: at, updatedAt: at })
      .where(and(eq(schema.authSession.userId, userId), isNull(schema.authSession.revokedAt)))
      .returning({ id: schema.authSession.id });
    return rows.length;
  }
}
