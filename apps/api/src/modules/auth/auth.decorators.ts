import type { Role } from '@fabric/contracts';
import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { requestContext } from '../../common/index.js';

export const IS_PUBLIC = Symbol('is-public');
export const PARTNER_MAY_WRITE = Symbol('partner-may-write');

/** Opens a route to anyone: the global AuthGuard requires a valid access token everywhere else. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

/**
 * A non-GET route a read-only partner account may still call (it changes no shop data, e.g.
 * registering the device for its code). Everything else that writes needs the owner.
 */
export const PartnerMayCall = (): MethodDecorator => SetMetadata(PARTNER_MAY_WRITE, true);

export interface AuthenticatedUser {
  id: string;
  role: Role;
  sessionId: string;
}

export type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

/** The signed-in user (a protected route only). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) throw new Error('CurrentUser used on a public route');
    return user;
  },
);

/** Makes `userId` the actor of the audit entries written for this request. */
export function actAs(userId: string): void {
  const context = requestContext();
  if (context) context.actorId = userId;
}
