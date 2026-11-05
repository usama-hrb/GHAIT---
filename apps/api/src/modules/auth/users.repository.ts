import type { Role } from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema, TransactionHost } from '../../database/index.js';
import type { SessionRow } from './sessions.repository.js';

export type UserRow = typeof schema.appUser.$inferSelect;

@Injectable()
export class UsersRepository {
  constructor(private readonly tx: TransactionHost) {}

  async findByUsername(username: string): Promise<UserRow | undefined> {
    const [row] = await this.tx.db
      .select()
      .from(schema.appUser)
      .where(eq(schema.appUser.username, username));
    return row;
  }

  async findById(id: string): Promise<UserRow | undefined> {
    const [row] = await this.tx.db.select().from(schema.appUser).where(eq(schema.appUser.id, id));
    return row;
  }

  /**
   * The account and the session an access token names, for the AuthGuard (ADR 0024): one lookup
   * by primary key, so a token stops working the moment its session is revoked or its account
   * switched off, not when it expires. The session must be the user's own.
   */
  async findAccess(
    userId: string,
    sessionId: string,
  ): Promise<{ user: UserRow; session: SessionRow } | undefined> {
    const [row] = await this.tx.db
      .select({ user: schema.appUser, session: schema.authSession })
      .from(schema.authSession)
      .innerJoin(schema.appUser, eq(schema.appUser.id, schema.authSession.userId))
      .where(and(eq(schema.authSession.id, sessionId), eq(schema.appUser.id, userId)));
    return row;
  }

  findByRole(role: Role): Promise<UserRow[]> {
    return this.tx.db.select().from(schema.appUser).where(eq(schema.appUser.role, role));
  }

  async insert(user: {
    username: string;
    displayName: string;
    passwordHash: string;
    role: Role;
    deviceId: string;
  }): Promise<UserRow> {
    const [row] = await this.tx.db.insert(schema.appUser).values(user).returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  }

  /** `mustChange`: the password is one somebody else chose, to be replaced at the next sign-in. */
  async setPassword(
    id: string,
    passwordHash: string,
    deviceId: string,
    { mustChange = false }: { mustChange?: boolean } = {},
  ): Promise<UserRow> {
    const now = new Date();
    const [row] = await this.tx.db
      .update(schema.appUser)
      .set({
        passwordHash,
        passwordChangedAt: now,
        mustChangePassword: mustChange,
        updatedAt: now,
        deviceId,
      })
      .where(eq(schema.appUser.id, id))
      .returning();
    if (!row) throw new Error(`no user ${id}`);
    return row;
  }
}
