import type { AccountListQuery, EligiblePartner, Role } from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm';
import { schema, TransactionHost } from '../../database/index.js';
import type { UserRow } from '../auth/index.js';

export type PartnerRow = typeof schema.partner.$inferSelect;

/** An account with the partner it is linked to (partner accounts only). */
export interface AccountRow {
  user: UserRow;
  partner: PartnerRow | null;
}

/**
 * The login accounts as the owner manages them (ADR 0024). Reads and writes `app_user` rows for
 * the owner's screen; signing in and the tokens are the auth module's. Never reads or writes a
 * partner, an employee or any money: a login is not a business record.
 */
@Injectable()
export class AccountsRepository {
  constructor(private readonly tx: TransactionHost) {}

  async list({ role, status }: AccountListQuery): Promise<AccountRow[]> {
    const u = schema.appUser;
    const conditions: (SQL | undefined)[] = [
      role === undefined ? undefined : eq(u.role, role),
      status === 'active' ? and(isNull(u.deactivatedAt), isNull(u.voidedAt)) : undefined,
      status === 'inactive' ? or(isNotNull(u.deactivatedAt), isNotNull(u.voidedAt)) : undefined,
    ];
    return this.tx.db
      .select({ user: u, partner: schema.partner })
      .from(u)
      .leftJoin(schema.partner, eq(schema.partner.id, u.partnerId))
      .where(and(...conditions))
      .orderBy(asc(u.createdAt), asc(u.username));
  }

  async find(id: string): Promise<AccountRow | undefined> {
    const [row] = await this.tx.db
      .select({ user: schema.appUser, partner: schema.partner })
      .from(schema.appUser)
      .leftJoin(schema.partner, eq(schema.partner.id, schema.appUser.partnerId))
      .where(eq(schema.appUser.id, id));
    return row;
  }

  async usernameTaken(username: string): Promise<boolean> {
    const [row] = await this.tx.db
      .select({ id: schema.appUser.id })
      .from(schema.appUser)
      .where(eq(schema.appUser.username, username));
    return row !== undefined;
  }

  async findPartner(id: string): Promise<PartnerRow | undefined> {
    const [row] = await this.tx.db.select().from(schema.partner).where(eq(schema.partner.id, id));
    return row;
  }

  /** The partners in the shop with this name, whatever the case: the command line names one so. */
  findPartnersByName(name: string): Promise<PartnerRow[]> {
    return this.tx.db
      .select()
      .from(schema.partner)
      .where(
        and(isNull(schema.partner.voidedAt), sql`lower(${schema.partner.name}) = lower(${name})`),
      );
  }

  /** The active account of a partner, if any (at most one: a partial unique index). */
  async activeAccountOfPartner(partnerId: string): Promise<UserRow | undefined> {
    const u = schema.appUser;
    const [row] = await this.tx.db
      .select()
      .from(u)
      .where(and(eq(u.partnerId, partnerId), isNull(u.deactivatedAt), isNull(u.voidedAt)));
    return row;
  }

  /**
   * Partners who can be given a login: still in the shop, not the owner (who has the owner's
   * account), and with no active account.
   */
  async eligiblePartners(): Promise<EligiblePartner[]> {
    const p = schema.partner;
    const u = schema.appUser;
    const rows = await this.tx.db
      .select({ id: p.id, name: p.name, title: p.title })
      .from(p)
      .leftJoin(u, and(eq(u.partnerId, p.id), isNull(u.deactivatedAt), isNull(u.voidedAt)))
      .where(and(isNull(p.voidedAt), isNull(p.exitedOn), eq(p.isOwner, false), isNull(u.id)))
      .orderBy(asc(p.name));
    return rows;
  }

  async insert(account: {
    username: string;
    displayName: string;
    passwordHash: string;
    role: Exclude<Role, 'owner'>;
    partnerId: string | null;
    deviceId: string;
    /** The password is one somebody else chose: the account replaces it at its first sign-in. */
    mustChangePassword: boolean;
  }): Promise<UserRow> {
    const [row] = await this.tx.db.insert(schema.appUser).values(account).returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  }

  /** Switches an account off (`at`) or on (null). The account row stays either way. */
  async setDeactivated(id: string, at: Date | null, deviceId: string): Promise<UserRow> {
    const [row] = await this.tx.db
      .update(schema.appUser)
      .set({ deactivatedAt: at, updatedAt: new Date(), deviceId })
      .where(eq(schema.appUser.id, id))
      .returning();
    if (!row) throw new Error(`no user ${id}`);
    return row;
  }

  /** `mustChange`: a password the server made, which the account replaces at its next sign-in. */
  async setPassword(
    id: string,
    passwordHash: string,
    deviceId: string,
    mustChange: boolean,
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
