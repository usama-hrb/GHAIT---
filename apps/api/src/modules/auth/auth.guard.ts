import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppHttpException } from '../../common/index.js';
import {
  actAs,
  type AuthenticatedRequest,
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
 * BUILD_PROMPTS 4.2): the owner may do everything; a partner may read everything and write
 * nothing (only routes marked @PartnerMayCall()). The cashier role is not let in yet (5.3).
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
    const mayCall =
      claims.role === 'owner' ||
      (claims.role === 'partner' &&
        (READS.has(request.method) ||
          this.reflector.get<boolean | undefined>(PARTNER_MAY_WRITE, context.getHandler()) ===
            true));
    if (!mayCall) {
      throw new AppHttpException(
        'forbidden',
        claims.role === 'partner'
          ? 'A partner account can read, not change, the shop'
          : 'Not allowed',
        HttpStatus.FORBIDDEN,
      );
    }
    request.user = { id: claims.sub, role: claims.role, sessionId: claims.sid };
    actAs(claims.sub);
    return true;
  }
}
