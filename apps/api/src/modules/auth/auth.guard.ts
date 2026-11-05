import { ACCOUNT_ISSUES } from '@fabric/contracts';
import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppHttpException, OWNER_ONLY } from '../../common/index.js';
import {
  actAs,
  type AuthenticatedRequest,
  CASHIER_MAY_CALL,
  IS_PUBLIC,
  PARTNER_MAY_WRITE,
  PASSWORD_CHANGE_ROUTE,
} from './auth.decorators.js';
import { TokenService } from './token.service.js';
import { UsersRepository } from './users.repository.js';

function bearerToken(header: string | undefined): string | undefined {
  const match = header?.match(/^Bearer ([A-Za-z0-9._~+/-]+=*)$/);
  return match?.[1];
}

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global: every route needs a valid access token unless it is @Public(). Roles (SPEC §11,
 * BUILD_PROMPTS 4.2, 5.3): the owner may do everything; a partner may read everything and write
 * nothing (only routes marked @PartnerMayCall()) and never a route marked @OwnerOnly(); a cashier
 * may call only the routes marked @CashierMayCall(), and what those send it is filtered by role
 * (RL1–RL3).
 *
 * The token is checked against the database on every call (ADR 0024): its session must not be
 * revoked and its account must exist, be switched on, and still have the role the token names, so
 * deactivating an account or resetting its password takes effect at once and not when the access
 * token runs out. The role comes from the account's row, never from the client.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly users: UsersRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request.headers.authorization);
    if (!token) {
      throw new AppHttpException('unauthorized', 'Missing bearer token', HttpStatus.UNAUTHORIZED);
    }
    const claims = await this.tokens.verifyAccess(token);
    const access = await this.users.findAccess(claims.sub, claims.sid);
    if (
      !access ||
      access.session.revokedAt !== null ||
      access.user.voidedAt !== null ||
      access.user.deactivatedAt !== null ||
      access.user.role !== claims.role
    ) {
      throw new AppHttpException(
        'unauthorized',
        'Session is no longer valid',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const flagged = (key: symbol) =>
      this.reflector.get<boolean | undefined>(key, context.getHandler()) === true;
    if (access.user.mustChangePassword && !flagged(PASSWORD_CHANGE_ROUTE)) {
      throw new AppHttpException('forbidden', 'Choose a new password first', HttpStatus.FORBIDDEN, [
        {
          path: [],
          message: 'Choose a new password first',
          code: ACCOUNT_ISSUES.passwordChangeRequired,
        },
      ]);
    }
    const ownerOnly =
      this.reflector.getAllAndOverride<boolean | undefined>(OWNER_ONLY, [
        context.getHandler(),
        context.getClass(),
      ]) === true;
    const mayCall =
      claims.role === 'owner' ||
      (!ownerOnly &&
        ((claims.role === 'partner' && (READS.has(request.method) || flagged(PARTNER_MAY_WRITE))) ||
          (claims.role === 'cashier' && flagged(CASHIER_MAY_CALL))));
    if (!mayCall) {
      throw new AppHttpException(
        'forbidden',
        claims.role === 'partner' && !ownerOnly
          ? 'A partner account can read, not change, the shop'
          : 'This account cannot do that',
        HttpStatus.FORBIDDEN,
      );
    }
    const partnerId = access.user.partnerId;
    request.user = { id: claims.sub, role: claims.role, sessionId: claims.sid, partnerId };
    actAs(claims.sub, claims.role, partnerId);
    return true;
  }
}
