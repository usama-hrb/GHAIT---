import {
  ACCOUNT_ISSUES,
  type Account,
  type AccountChange,
  type AccountCredential,
  type AccountListQuery,
  type DeactivateAccount,
  type EligiblePartner,
  idSchema,
  type NewCashierAccount,
  type NewPartnerAccount,
  newPasswordSchema,
  SERVER_DEVICE_ID,
  usernameSchema,
} from '@fabric/contracts';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppHttpException, requestContext } from '../../common/index.js';
import { TransactionHost } from '../../database/index.js';
import { AuditService } from '../audit/index.js';
import { auditView, PasswordHasher, SessionsRepository, type UserRow } from '../auth/index.js';
import { type AccountRow, AccountsRepository, type PartnerRow } from './accounts.repository.js';
import { temporaryPassword } from './temporary-password.js';

const USERNAME_UNIQUE = 'app_user_username_unique';
const ONE_ACTIVE_PARTNER_ACCOUNT = 'app_user_one_active_partner_account';

/** The name of the constraint a Postgres error broke (the driver error drizzle wraps). */
function constraintOf(exception: unknown): string | undefined {
  for (let error = exception, depth = 0; error instanceof Error && depth < 3; depth++) {
    const name: unknown = (error as Error & { constraint?: unknown }).constraint;
    if (typeof name === 'string') return name;
    error = error.cause;
  }
  return undefined;
}

const refusal = (
  code: 'conflict' | 'forbidden' | 'validation_failed',
  status: HttpStatus,
  issue: string,
  message: string,
  path: (string | number)[] = [],
) => new AppHttpException(code, message, status, [{ path, message, code: issue }]);

const usernameTaken = () =>
  refusal(
    'conflict',
    HttpStatus.CONFLICT,
    ACCOUNT_ISSUES.usernameTaken,
    'Username already in use',
    ['username'],
  );

const partnerHasAccount = () =>
  refusal(
    'conflict',
    HttpStatus.CONFLICT,
    ACCOUNT_ISSUES.partnerHasAccount,
    'This partner already has an active account',
    ['partnerId'],
  );

const isInactive = (user: UserRow) => user.deactivatedAt !== null || user.voidedAt !== null;

function toAccount({ user, partner }: AccountRow): Account {
  const switchedOff = user.deactivatedAt ?? user.voidedAt;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    status: isInactive(user) ? 'inactive' : 'active',
    deactivatedAt: switchedOff?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    mustChangePassword: user.mustChangePassword,
    partner: partner ? { id: partner.id, name: partner.name, exitedOn: partner.exitedOn } : null,
  };
}

/**
 * The owner's account management (ADR 0024): cashier and partner logins, switched on and off,
 * with their passwords reset. A login is not a business record. Nothing here creates, changes or
 * removes a partner, an employee, a balance, a capital contribution, a settlement or a sale, and
 * the role of an account is chosen by the route that creates it, never by the request.
 *
 * Every write runs in the request's one transaction (which also takes the write lock every write
 * takes) and writes its audit entry; the rules the database enforces on its own (one username, one
 * active account per partner, one owner) are the guarantee under concurrency, the checks before
 * them give the better message.
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly accounts: AccountsRepository,
    private readonly sessions: SessionsRepository,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditService,
    private readonly tx: TransactionHost,
  ) {}

  async list(query: AccountListQuery): Promise<Account[]> {
    return (await this.accounts.list(query)).map(toAccount);
  }

  eligiblePartners(): Promise<EligiblePartner[]> {
    return this.accounts.eligiblePartners();
  }

  /** A cashier's login: no partner, no employee, and no limit on how many. */
  async createCashier(input: NewCashierAccount): Promise<AccountCredential> {
    return this.create(
      { ...input, role: 'cashier', partnerId: null },
      null,
      'cashier account created by the owner',
    );
  }

  /** A login for an existing partner who has none: the partner record is not touched. */
  async createPartner(input: NewPartnerAccount): Promise<AccountCredential> {
    const partner = await this.partnerFor(input.partnerId);
    if (await this.accounts.activeAccountOfPartner(partner.id)) throw partnerHasAccount();
    return this.create(
      { ...input, role: 'partner', partnerId: partner.id },
      partner,
      `partner account created by the owner for ${partner.name}`,
    );
  }

  /**
   * For the create-partner-user command: the login of the partner named by `partner` (their name or
   * their id), with the password the person at the terminal typed, or a new password for the
   * login the partner already has (signing it out everywhere). Like the owner's screen, it never
   * makes a partner and never links a login to more than one.
   */
  setPartnerLogin(input: {
    partner: string;
    username: string;
    password: string;
    displayName?: string;
  }): Promise<'created' | 'password_reset'> {
    const username = usernameSchema.parse(input.username);
    const password = newPasswordSchema.parse(input.password);
    return this.tx.run(async () => {
      const named = await this.partnerNamed(input.partner);
      const partner = await this.partnerFor(named.id);
      const existing = await this.accounts.activeAccountOfPartner(partner.id);
      if (existing && existing.username !== username) {
        throw new Error(
          `${partner.name} already has an active account (${existing.username}); give that username to reset its password`,
        );
      }
      if (existing) {
        const current = await this.accounts.find(existing.id);
        if (!current) throw new Error(`no user ${existing.id}`);
        const updated = await this.accounts.setPassword(
          existing.id,
          await this.hasher.hash(password),
          SERVER_DEVICE_ID,
          false,
        );
        await this.sessions.revokeAllOfUser(existing.id, new Date());
        await this.audit.record({
          entity: 'app_user',
          entityId: existing.id,
          action: 'password_set',
          before: auditView(existing),
          after: auditView(updated),
          reason: 'password reset from the command line',
        });
        return 'password_reset';
      }
      if (await this.accounts.usernameTaken(username)) {
        throw new Error(`${username} already signs in to another account`);
      }
      const user = await this.accounts.insert({
        username,
        displayName: input.displayName?.trim() || partner.name,
        passwordHash: await this.hasher.hash(password),
        role: 'partner',
        partnerId: partner.id,
        deviceId: SERVER_DEVICE_ID,
        mustChangePassword: false,
      });
      await this.audit.record({
        entity: 'app_user',
        entityId: user.id,
        action: 'create',
        before: null,
        after: auditView(user),
        reason: `partner account created from the command line for ${partner.name}`,
      });
      return 'created';
    });
  }

  async deactivate(id: string, { reason }: DeactivateAccount): Promise<Account> {
    const current = await this.manageable(id);
    if (isInactive(current.user)) {
      throw refusal(
        'conflict',
        HttpStatus.CONFLICT,
        ACCOUNT_ISSUES.alreadyInactive,
        'This account is already deactivated',
      );
    }
    const now = new Date();
    const updated = await this.accounts.setDeactivated(id, now, this.deviceId());
    // Every session ends now; the guard also refuses the tokens already issued (ADR 0024).
    await this.sessions.revokeAllOfUser(id, now);
    await this.audit.record({
      entity: 'app_user',
      entityId: id,
      action: 'deactivate',
      before: auditView(current.user),
      after: auditView(updated),
      reason,
    });
    return toAccount({ user: updated, partner: current.partner });
  }

  /**
   * Switches an account back on with a new temporary password: it was out of use, and the person
   * is asked to choose their own again. A partner's login comes back only if the partner is still
   * in the shop and has no other active account.
   */
  async reactivate(id: string, { reason }: AccountChange): Promise<AccountCredential> {
    const current = await this.manageable(id);
    if (!isInactive(current.user)) {
      throw refusal(
        'conflict',
        HttpStatus.CONFLICT,
        ACCOUNT_ISSUES.alreadyActive,
        'This account is already active',
      );
    }
    if (current.user.voidedAt !== null) {
      throw refusal(
        'conflict',
        HttpStatus.CONFLICT,
        ACCOUNT_ISSUES.inactive,
        'This account was removed',
      );
    }
    if (current.user.role === 'partner') {
      if (current.user.partnerId === null) {
        throw refusal(
          'conflict',
          HttpStatus.CONFLICT,
          ACCOUNT_ISSUES.notLinked,
          'This partner account is not linked to a partner; create a new one',
        );
      }
      const partner = await this.partnerFor(current.user.partnerId);
      if (await this.accounts.activeAccountOfPartner(partner.id)) throw partnerHasAccount();
    }
    const reactivated = await this.guarded(() =>
      this.accounts.setDeactivated(id, null, this.deviceId()),
    );
    await this.audit.record({
      entity: 'app_user',
      entityId: id,
      action: 'reactivate',
      before: auditView(current.user),
      after: auditView(reactivated),
      reason,
    });
    return this.issueCredential(
      { user: reactivated, partner: current.partner },
      'temporary password issued when the account was reactivated',
    );
  }

  /** A new temporary password for an active account; every session of it ends. */
  async resetCredentials(id: string, { reason }: AccountChange): Promise<AccountCredential> {
    const current = await this.manageable(id);
    if (isInactive(current.user)) {
      throw refusal(
        'conflict',
        HttpStatus.CONFLICT,
        ACCOUNT_ISSUES.inactive,
        'This account is deactivated',
      );
    }
    return this.issueCredential(current, reason ?? 'password reset by the owner');
  }

  private async create(
    account: {
      username: string;
      displayName: string;
      role: 'cashier' | 'partner';
      partnerId: string | null;
    },
    partner: PartnerRow | null,
    reason: string,
  ): Promise<AccountCredential> {
    if (await this.accounts.usernameTaken(account.username)) throw usernameTaken();
    const password = temporaryPassword();
    const user = await this.guarded(async () =>
      this.accounts.insert({
        ...account,
        passwordHash: await this.hasher.hash(password),
        deviceId: this.deviceId(),
        mustChangePassword: true,
      }),
    );
    await this.audit.record({
      entity: 'app_user',
      entityId: user.id,
      action: 'create',
      before: null,
      after: auditView(user),
      reason,
    });
    return { account: toAccount({ user, partner }), temporaryPassword: password };
  }

  private async issueCredential(current: AccountRow, reason: string): Promise<AccountCredential> {
    const password = temporaryPassword();
    const updated = await this.accounts.setPassword(
      current.user.id,
      await this.hasher.hash(password),
      this.deviceId(),
      true,
    );
    await this.sessions.revokeAllOfUser(current.user.id, new Date());
    await this.audit.record({
      entity: 'app_user',
      entityId: current.user.id,
      action: 'password_set',
      before: auditView(current.user),
      after: auditView(updated),
      reason,
    });
    return {
      account: toAccount({ user: updated, partner: current.partner }),
      temporaryPassword: password,
    };
  }

  /** The account, if it exists and is one the owner manages here (not the owner's own). */
  private async manageable(id: string): Promise<AccountRow> {
    const found = await this.accounts.find(id);
    if (!found) throw new AppHttpException('not_found', `No account ${id}`, HttpStatus.NOT_FOUND);
    if (found.user.role === 'owner') {
      throw refusal(
        'forbidden',
        HttpStatus.FORBIDDEN,
        ACCOUNT_ISSUES.ownerAccount,
        "The owner's account is not managed here",
      );
    }
    return found;
  }

  /** The partner a command-line argument names: an id, or a name that only one partner has. */
  private async partnerNamed(nameOrId: string): Promise<PartnerRow> {
    const byId = idSchema.safeParse(nameOrId);
    if (byId.success) {
      const partner = await this.accounts.findPartner(byId.data);
      if (partner) return partner;
    }
    const byName = await this.accounts.findPartnersByName(nameOrId.trim());
    if (byName.length === 1 && byName[0]) return byName[0];
    throw new Error(
      byName.length === 0
        ? `No partner is called "${nameOrId}"; the partner must already exist (Settings, Partners)`
        : `More than one partner is called "${nameOrId}"; give the partner's id instead`,
    );
  }

  /** A partner who can have a login: in the shop, not the owner, not gone (S19, S20). */
  private async partnerFor(id: string): Promise<PartnerRow> {
    const partner = await this.accounts.findPartner(id);
    const unknown = () =>
      refusal(
        'validation_failed',
        HttpStatus.BAD_REQUEST,
        ACCOUNT_ISSUES.partnerNotFound,
        'No such partner',
        ['partnerId'],
      );
    if (!partner || partner.voidedAt !== null) throw unknown();
    if (partner.isOwner) {
      throw refusal(
        'validation_failed',
        HttpStatus.BAD_REQUEST,
        ACCOUNT_ISSUES.partnerIsOwner,
        'The owner has the owner account',
        ['partnerId'],
      );
    }
    if (partner.exitedOn !== null) {
      throw refusal(
        'validation_failed',
        HttpStatus.BAD_REQUEST,
        ACCOUNT_ISSUES.partnerExited,
        'This partner has left the shop',
        ['partnerId'],
      );
    }
    return partner;
  }

  /** Turns the database's refusal of a duplicate into the answer the checks above would give. */
  private async guarded<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      const constraint = constraintOf(error);
      if (constraint === USERNAME_UNIQUE) throw usernameTaken();
      if (constraint === ONE_ACTIVE_PARTNER_ACCOUNT) throw partnerHasAccount();
      throw error;
    }
  }

  private deviceId(): string {
    return requestContext()?.deviceId ?? SERVER_DEVICE_ID;
  }
}
