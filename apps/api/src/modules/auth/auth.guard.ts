import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppHttpException } from '../../common/index.js';
import {
  actAs,
  type AuthenticatedRequest,
  CASHIER_MAY_CALL,
  IS_PUBLIC,
  PARTNER_MAY_WRITE,
} from './auth.decorators.js';
import { TokenService } from './token.service.js';

function bearerToken(header: string | undefined): string | undefined {
  const match = header?.match(/^Bearer ([A-Za-z0-9._~+/-]+=*)$/);
  return match?.[1];
}

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global: every route needs a valid access token unless it is @Public(). Roles (SPEC §11,
 * BUILD_PROMPTS 4.2, 5.3): the owner may do everything; a partner may read everything and write
 * nothing (only routes marked @PartnerMayCall()); a cashier may call only the routes marked
 * @CashierMayCall(), and what those send it is filtered by role (RL1–RL3).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
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
    const flagged = (key: symbol) =>
      this.reflector.get<boolean | undefined>(key, context.getHandler()) === true;
    const mayCall =
      claims.role === 'owner' ||
      (claims.role === 'partner' && (READS.has(request.method) || flagged(PARTNER_MAY_WRITE))) ||
      (claims.role === 'cashier' && flagged(CASHIER_MAY_CALL));
    if (!mayCall) {
      throw new AppHttpException(
        'forbidden',
        claims.role === 'partner'
          ? 'A partner account can read, not change, the shop'
          : 'This account cannot do that',
        HttpStatus.FORBIDDEN,
      );
    }
    request.user = { id: claims.sub, role: claims.role, sessionId: claims.sid };
    actAs(claims.sub, claims.role);
    return true;
  }
}
