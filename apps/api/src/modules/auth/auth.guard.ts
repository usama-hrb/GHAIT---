import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppHttpException } from '../../common/index.js';
import { actAs, type AuthenticatedRequest, IS_PUBLIC } from './auth.decorators.js';
import { TokenService } from './token.service.js';

function bearerToken(header: string | undefined): string | undefined {
  const match = header?.match(/^Bearer ([A-Za-z0-9._~+/-]+=*)$/);
  return match?.[1];
}

/**
 * Global: every route needs a valid access token unless it is @Public(). The schema has the
 * owner, partner and cashier roles (SPEC §11); only the owner is let in for now (BUILD_PROMPTS
 * 2.1). Per-role rules arrive with the partner and cashier accounts.
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
    if (claims.role !== 'owner') {
      throw new AppHttpException(
        'forbidden',
        'Only the owner can use the API for now',
        HttpStatus.FORBIDDEN,
      );
    }
    request.user = { id: claims.sub, role: claims.role, sessionId: claims.sid };
    actAs(claims.sub);
    return true;
  }
}
