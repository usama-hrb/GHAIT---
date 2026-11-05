import { randomUUID } from 'node:crypto';
import {
  ACCOUNT_ISSUES,
  type AccessTokenResponse,
  type AuthUser,
  type ChangePasswordRequest,
  type LoginRequest,
  newPasswordSchema,
  REGISTRATION_ISSUES,
  SERVER_DEVICE_ID,
  usernameSchema,
} from '@fabric/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AppHttpException, requestContext, sqlState } from '../../common/index.js';
import { APP_CONFIG, type AppConfig } from '../../config/index.js';
import { TransactionHost } from '../../database/index.js';
import { AuditService } from '../audit/index.js';
import { actAs, type AuthenticatedUser } from './auth.decorators.js';
import { PasswordHasher } from './password-hasher.js';
import { SessionsRepository } from './sessions.repository.js';
import { TokenService } from './token.service.js';
import { type UserRow, UsersRepository } from './users.repository.js';

export interface IssuedTokens {
  response: AccessTokenResponse;
  /** For the httpOnly cookie only. */
  refreshToken: string;
  refreshExpiresAt: Date;
}

const DAY_MS = 86_400_000;
/**
 * A rotated token presented again this soon is a client that never received its successor (a
 * page load aborted the refresh response), not theft: it is rotated again. Later, it is reuse.
 */
const REUSE_GRACE_MS = 30_000;

/**
 * Who may sign in (BUILD_PROMPTS 4.2, 5.3): the owner; the partner, read-only; a cashier, who
 * sells and never sees a cost or a profit (what each may reach is decided in the AuthGuard and
 * the sync hub).
 */
const SIGN_IN_ROLES: ReadonlySet<string> = new Set(['owner', 'partner', 'cashier']);

function toAuthUser(user: UserRow): AuthUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  };
}

/** What the audit log may show of a user: never the password hash. */
export function auditView(user: UserRow) {
  return {
    ...toAuthUser(user),
    partnerId: user.partnerId,
    passwordChangedAt: user.passwordChangedAt,
    deactivatedAt: user.deactivatedAt,
    voidedAt: user.voidedAt,
  };
}

const signUpClosed = () =>
  new AppHttpException('forbidden', 'Sign-up is closed', HttpStatus.FORBIDDEN, [
    { path: [], message: 'Sign-up is closed', code: REGISTRATION_ISSUES.registrationClosed },
  ]);

const unauthorized = (message: string) =>
  new AppHttpException('unauthorized', message, HttpStatus.UNAUTHORIZED);

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly tx: TransactionHost,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The same answer for an unknown username and a wrong password, in the same time. */
  async login(input: LoginRequest): Promise<IssuedTokens> {
    const found = await this.users.findByUsername(input.username);
    const user = found && !found.voidedAt ? found : undefined;
    const ok = await this.hasher.verify(user?.passwordHash ?? null, input.password);
    if (!user || !ok) {
      throw new AppHttpException(
        'invalid_credentials',
        'Invalid username or password',
        HttpStatus.UNAUTHORIZED,
      );
    }
    // Said only to someone who knew the password, so it tells a stranger nothing (ADR 0024).
    if (user.deactivatedAt) {
      throw new AppHttpException(
        'forbidden',
        'This account has been deactivated',
        HttpStatus.FORBIDDEN,
        [
          {
            path: [],
            message: 'This account has been deactivated',
            code: ACCOUNT_ISSUES.deactivated,
          },
        ],
      );
    }
    if (!SIGN_IN_ROLES.has(user.role)) {
      throw new AppHttpException(
        'forbidden',
        'This account cannot sign in yet',
        HttpStatus.FORBIDDEN,
      );
    }
    actAs(user.id, user.role, user.partnerId);
    const issued = await this.startSession(user, randomUUID());
    await this.audit.record({
      entity: 'app_user',
      entityId: user.id,
      action: 'login',
      before: null,
      after: { sessionId: issued.sessionId },
    });
    return issued;
  }

  /**
   * Whether the sign-up page may create an owner: only while the server has none (ADR 0023), and
   * only if the operator has not turned it off.
   */
  async ownerSignupOpen(): Promise<boolean> {
    return this.config.auth.ownerSignupEnabled && !(await this.hasOwner());
  }

  /**
   * The first owner setting the shop up (ADR 0023): the account, whatever `setUpShop` writes for
   * the shop, and the first session, in the request's one transaction, so a failure leaves nothing
   * behind. The role is the server's choice, never the request's, and the database allows one
   * owner only (a partial unique index), so two sign-ups racing each other cannot both succeed.
   * Open only while the server has no owner.
   */
  async registerOwner(
    account: { email: string; fullName: string; password: string },
    setUpShop: (owner: AuthUser) => Promise<void>,
  ): Promise<IssuedTokens> {
    // Cheap refusals first: a closed server never hashes a password.
    if (!(await this.ownerSignupOpen())) throw signUpClosed();
    if (await this.users.findByUsername(account.email)) {
      throw new AppHttpException('conflict', 'Email already in use', HttpStatus.CONFLICT, [
        { path: ['email'], message: 'Email already in use', code: REGISTRATION_ISSUES.emailTaken },
      ]);
    }
    const passwordHash = await this.hasher.hash(account.password);
    let user: UserRow;
    try {
      user = await this.users.insert({
        username: account.email,
        displayName: account.fullName,
        passwordHash,
        role: 'owner',
        deviceId: requestContext()?.deviceId ?? SERVER_DEVICE_ID,
      });
    } catch (error) {
      // The other sign-up won the race for the single owner row.
      if (sqlState(error) === '23505') throw signUpClosed();
      throw error;
    }
    actAs(user.id, user.role);
    await this.audit.record({
      entity: 'app_user',
      entityId: user.id,
      action: 'create',
      before: null,
      after: auditView(user),
      reason: 'owner signed up on the sign-up page',
    });
    await setUpShop(toAuthUser(user));

    const issued = await this.startSession(user, randomUUID());
    await this.audit.record({
      entity: 'app_user',
      entityId: user.id,
      action: 'login',
      before: null,
      after: { sessionId: issued.sessionId },
    });
    return issued;
  }

  private async hasOwner(): Promise<boolean> {
    return (await this.users.findByRole('owner')).some((owner) => !owner.voidedAt);
  }

  /**
   * Rotates the refresh token. A token used again after the grace period means it leaked: the
   * whole family is revoked and every device signs in again. Within the grace period the client
   * just missed its new cookie: the token rotates again and the successor it never got is
   * revoked. Runs its own transaction, so a revocation is kept although the request fails.
   */
  async refresh(token: string | undefined): Promise<IssuedTokens> {
    if (!token) throw unauthorized('No refresh token');
    const now = new Date();
    const outcome = await this.tx.run(async () => {
      const session = await this.sessions.findByTokenHashForUpdate(
        this.tokens.hashRefreshToken(token),
      );
      if (!session) return { kind: 'invalid' } as const;
      const retry =
        session.rotatedAt !== null &&
        session.revokedAt === null &&
        now.getTime() - session.rotatedAt.getTime() <= REUSE_GRACE_MS;
      if ((session.rotatedAt && !retry) || session.revokedAt) {
        actAs(session.userId);
        const revoked = await this.sessions.revokeFamily(session.familyId, now);
        await this.audit.record({
          entity: 'auth_session',
          entityId: session.familyId,
          action: 'logout',
          before: null,
          after: { revokedSessions: revoked },
          reason: 'refresh token used twice: signed out everywhere',
        });
        return { kind: 'reused' } as const;
      }
      const user = await this.users.findById(session.userId);
      if (
        session.expiresAt <= now ||
        !user ||
        user.voidedAt ||
        user.deactivatedAt ||
        !SIGN_IN_ROLES.has(user.role)
      ) {
        return { kind: 'invalid' } as const;
      }
      if (retry) await this.sessions.revokeFamily(session.familyId, now, { except: session.id });
      else await this.sessions.markRotated(session.id, now);
      return { kind: 'ok', issued: await this.startSession(user, session.familyId) } as const;
    });
    if (outcome.kind === 'reused')
      throw unauthorized('Refresh token already used; signed out everywhere');
    if (outcome.kind === 'invalid') throw unauthorized('Invalid or expired refresh token');
    return outcome.issued;
  }

  /** Revokes the token's family. Without a (known) token there is nothing to do. */
  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.tx.run(async () => {
      const session = await this.sessions.findByTokenHashForUpdate(
        this.tokens.hashRefreshToken(token),
      );
      if (!session) return;
      actAs(session.userId);
      const revoked = await this.sessions.revokeFamily(session.familyId, new Date());
      if (revoked === 0) return;
      await this.audit.record({
        entity: 'auth_session',
        entityId: session.familyId,
        action: 'logout',
        before: null,
        after: { revokedSessions: revoked },
      });
    });
  }

  async me(userId: string): Promise<AuthUser> {
    const user = await this.users.findById(userId);
    if (!user || user.voidedAt || user.deactivatedAt) throw unauthorized('User no longer exists');
    return toAuthUser(user);
  }

  /**
   * An account choosing its own password (ADR 0024): the one it has (the temporary one the owner
   * gave it, at its first sign-in), then a new one. Every other session of the account is signed
   * out; this one goes on. The account stops being asked for a new password.
   */
  async changePassword(
    actor: AuthenticatedUser,
    request: ChangePasswordRequest,
  ): Promise<AuthUser> {
    const current = await this.users.findById(actor.id);
    if (!current || current.voidedAt || current.deactivatedAt) {
      throw unauthorized('User no longer exists');
    }
    if (!(await this.hasher.verify(current.passwordHash, request.currentPassword))) {
      throw new AppHttpException('validation_failed', 'Wrong password', HttpStatus.BAD_REQUEST, [
        {
          path: ['currentPassword'],
          message: 'Wrong password',
          code: ACCOUNT_ISSUES.wrongPassword,
        },
      ]);
    }
    if (await this.hasher.verify(current.passwordHash, request.newPassword)) {
      throw new AppHttpException(
        'validation_failed',
        'Choose a different password',
        HttpStatus.BAD_REQUEST,
        [
          {
            path: ['newPassword'],
            message: 'Choose a different password',
            code: ACCOUNT_ISSUES.passwordUnchanged,
          },
        ],
      );
    }
    const updated = await this.users.setPassword(
      current.id,
      await this.hasher.hash(request.newPassword),
      requestContext()?.deviceId ?? SERVER_DEVICE_ID,
    );
    await this.sessions.revokeAllOfUser(current.id, new Date(), { except: actor.sessionId });
    await this.audit.record({
      entity: 'app_user',
      entityId: current.id,
      action: 'password_set',
      before: auditView(current),
      after: auditView(updated),
      reason: 'password changed by the account itself',
    });
    return toAuthUser(updated);
  }

  /**
   * For the create-owner command: creates the single owner account, or sets a new password for
   * it and signs it out everywhere. The only HTTP route that creates an owner is the first-owner
   * sign-up (`register`), which refuses once an owner exists.
   */
  async setOwner(input: {
    username: string;
    password: string;
    displayName?: string;
  }): Promise<'created' | 'password_reset'> {
    const username = usernameSchema.parse(input.username);
    const passwordHash = await this.hasher.hash(newPasswordSchema.parse(input.password));
    return this.tx.run(async () => {
      const owners = await this.users.findByRole('owner');
      const existing = owners.find((owner) => owner.username === username);
      if (!existing) {
        if (owners.length > 0) {
          const names = owners.map((owner) => owner.username).join(', ');
          throw new Error(
            `An owner already exists (${names}); give that username to reset its password`,
          );
        }
        const user = await this.users.insert({
          username,
          displayName: input.displayName?.trim() || username,
          passwordHash,
          role: 'owner',
          deviceId: SERVER_DEVICE_ID,
        });
        await this.audit.record({
          entity: 'app_user',
          entityId: user.id,
          action: 'create',
          before: null,
          after: auditView(user),
          reason: 'owner created from the command line',
        });
        return 'created';
      }
      const updated = await this.users.setPassword(existing.id, passwordHash, SERVER_DEVICE_ID);
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
    });
  }

  /**
   * For the create-cashier-user command: an account for a worker at the till (BUILD_PROMPTS 5.3):
   * it sells and takes payments, and never receives a cost or a profit. A new password signs it
   * out everywhere.
   */
  setCashierUser(input: {
    username: string;
    password: string;
    displayName?: string;
  }): Promise<'created' | 'password_reset'> {
    return this.setRoleUser('cashier', 'cashier account created from the command line', input);
  }

  private async setRoleUser(
    role: 'cashier',
    createdReason: string,
    input: { username: string; password: string; displayName?: string },
  ): Promise<'created' | 'password_reset'> {
    const username = usernameSchema.parse(input.username);
    const passwordHash = await this.hasher.hash(newPasswordSchema.parse(input.password));
    return this.tx.run(async () => {
      const existing = await this.users.findByUsername(username);
      if (existing && existing.role !== role) {
        throw new Error(`${username} is the ${existing.role}'s account, not a ${role}'s`);
      }
      if (!existing) {
        const user = await this.users.insert({
          username,
          displayName: input.displayName?.trim() || username,
          passwordHash,
          role,
          deviceId: SERVER_DEVICE_ID,
        });
        await this.audit.record({
          entity: 'app_user',
          entityId: user.id,
          action: 'create',
          before: null,
          after: auditView(user),
          reason: createdReason,
        });
        return 'created';
      }
      const updated = await this.users.setPassword(existing.id, passwordHash, SERVER_DEVICE_ID);
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
    });
  }

  private async startSession(
    user: UserRow,
    familyId: string,
  ): Promise<IssuedTokens & { sessionId: string }> {
    const { token, hash } = this.tokens.newRefreshToken();
    const refreshExpiresAt = new Date(Date.now() + this.config.auth.refreshTtlDays * DAY_MS);
    const session = await this.sessions.insert({
      userId: user.id,
      familyId,
      tokenHash: hash,
      expiresAt: refreshExpiresAt,
      deviceId: requestContext()?.deviceId ?? SERVER_DEVICE_ID,
    });
    return {
      sessionId: session.id,
      refreshToken: token,
      refreshExpiresAt,
      response: {
        accessToken: await this.tokens.signAccess(user, session.id),
        tokenType: 'Bearer',
        expiresIn: this.config.auth.accessTtlSeconds,
        user: toAuthUser(user),
      },
    };
  }
}
