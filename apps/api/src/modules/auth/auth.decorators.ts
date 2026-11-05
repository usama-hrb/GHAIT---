import type { Role } from '@fabric/contracts';
import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { requestContext } from '../../common/index.js';

export const IS_PUBLIC = Symbol('is-public');
export const PARTNER_MAY_WRITE = Symbol('partner-may-write');
export const CASHIER_MAY_CALL = Symbol('cashier-may-call');
export const PASSWORD_CHANGE_ROUTE = Symbol('password-change-route');

/** Opens a route to anyone: the global AuthGuard requires a valid access token everywhere else. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

/**
 * A non-GET route a read-only partner account may still call (it changes no shop data, e.g.
 * registering the device for its code). Everything else that writes needs the owner.
 */
export const PartnerMayCall = (): MethodDecorator => SetMetadata(PARTNER_MAY_WRITE, true);

/**
 * A route a cashier account may call (SPEC §11, RL2): the sync hub, where what a cashier sees and
 * pushes is filtered by role, and the device registration. Every other route refuses a cashier,
 * so nothing that carries a cost or a profit is reachable by mistake.
 */
export const CashierMayCall = (): MethodDecorator => SetMetadata(CASHIER_MAY_CALL, true);

/**
 * A route an account may call before it has replaced the password the owner gave it (ADR 0024):
 * who it is, and choosing the new password. The AuthGuard answers every other route with
 * `password_change_required` until then.
 */
export const MayCallWhileChangingPassword = (): MethodDecorator =>
  SetMetadata(PASSWORD_CHANGE_ROUTE, true);

export interface AuthenticatedUser {
  id: string;
  role: Role;
  sessionId: string;
  /** The partner a partner account is linked to; null for every other account. */
  partnerId: string | null;
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

/** Makes `userId` the actor of the audit entries written for this request, in this role. */
export function actAs(
  userId: string,
  role: Role | null = null,
  partnerId: string | null = null,
): void {
  const context = requestContext();
  if (context) {
    context.actorId = userId;
    context.actorRole = role;
    context.actorPartnerId = partnerId;
  }
}
