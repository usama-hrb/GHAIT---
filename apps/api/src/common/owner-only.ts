import { SetMetadata } from '@nestjs/common';

export const OWNER_ONLY = Symbol('owner-only');

/**
 * A route only the owner may call, reads included (ADR 0024, PS3). A partner account reads the
 * shop's numbers, but a route that returns every partner's money or the whole audit log would show
 * it another partner's; the partner gets its own records through sync instead.
 *
 * It lives in `common`, not beside the other auth decorators, because the audit module uses it and
 * the auth module imports the audit module: importing the auth module back would be a cycle.
 */
export const OwnerOnly = (): MethodDecorator & ClassDecorator => SetMetadata(OWNER_ONLY, true);
