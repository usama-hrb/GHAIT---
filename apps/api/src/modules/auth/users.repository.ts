import type { Role } from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema, TransactionHost } from '../../database/index.js';

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

  async setPassword(id: string, passwordHash: string, deviceId: string): Promise<UserRow> {
    const now = new Date();
    const [row] = await this.tx.db
      .update(schema.appUser)
      .set({ passwordHash, passwordChangedAt: now, updatedAt: now, deviceId })
      .where(eq(schema.appUser.id, id))
      .returning();
    if (!row) throw new Error(`no user ${id}`);
    return row;
  }
}
