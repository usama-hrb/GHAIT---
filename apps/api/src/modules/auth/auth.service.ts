import { randomUUID } from 'node:crypto';
import {
  type AccessTokenResponse,
  type AuthUser,
  type LoginRequest,
  newPasswordSchema,
  SERVER_DEVICE_ID,
  usernameSchema,
} from '@fabric/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AppHttpException, requestContext } from '../../common/index.js';
import { APP_CONFIG, type AppConfig } from '../../config/index.js';
import { TransactionHost } from '../../database/index.js';
import { AuditService } from '../audit/index.js';
import { actAs } from './auth.decorators.js';
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

/** Who may sign in (BUILD_PROMPTS 4.2): the owner, and the partner read-only. */
const SIGN_IN_ROLES: ReadonlySet<string> = new Set(['owner', 'partner']);

function toAuthUser(user: UserRow): AuthUser {
  return { id: user.id, username: user.username, displayName: user.displayName, role: user.role };
}

/** What the audit log may show of a user: never the password hash. */
function auditView(user: UserRow) {
  return {
    ...toAuthUser(user),
    passwordChangedAt: user.passwordChangedAt,
    voidedAt: user.voidedAt,
  };
}

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
    if (!SIGN_IN_ROLES.has(user.role)) {
      throw new AppHttpException(
        'forbidden',
        'This account cannot sign in yet',
        HttpStatus.FORBIDDEN,
      );
    }
    actAs(user.id);
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
      if (session.expiresAt <= now || !user || user.voidedAt || !SIGN_IN_ROLES.has(user.role)) {
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
    if (!user || user.voidedAt) throw unauthorized('User no longer exists');
    return toAuthUser(user);
  }

  /**
   * For the create-owner command: creates the single owner account, or sets a new password for
   * it and signs it out everywhere. There is deliberately no HTTP route that creates an owner.
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
   * For the create-partner-user command: a read-only account for the partner (BUILD_PROMPTS
   * 4.2), or a new password for it (signing it out everywhere).
   */
  async setPartnerUser(input: {
    username: string;
    password: string;
    displayName?: string;
  }): Promise<'created' | 'password_reset'> {
    const username = usernameSchema.parse(input.username);
    const passwordHash = await this.hasher.hash(newPasswordSchema.parse(input.password));
    return this.tx.run(async () => {
      const existing = await this.users.findByUsername(username);
      if (existing && existing.role !== 'partner') {
        throw new Error(`${username} is the ${existing.role}'s account, not a partner's`);
      }
      if (!existing) {
        const user = await this.users.insert({
          username,
          displayName: input.displayName?.trim() || username,
          passwordHash,
          role: 'partner',
          deviceId: SERVER_DEVICE_ID,
        });
        await this.audit.record({
          entity: 'app_user',
          entityId: user.id,
          action: 'create',
          before: null,
          after: auditView(user),
          reason: 'partner account created from the command line',
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
