import { type OwnerRegistrationRequest, type RegistrationStatus } from '@fabric/contracts';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/index.js';
import { AuthService, type IssuedTokens, signUpClosed } from '../auth/index.js';
import { SettingsService } from '../settings/index.js';
import { SetupCodes } from './setup-codes.service.js';

/**
 * The first owner setting a shop up (ADR 0023): the account (AuthService) and the shop's
 * settings, in the one transaction of the request, so a failure leaves neither. On a server with
 * many shops the owner also needs the shop's setup code (ADR 0029, Step 6): `codes` is there
 * only then.
 */
@Injectable()
export class RegistrationService {
  constructor(
    private readonly auth: AuthService,
    private readonly settings: SettingsService,
    @Inject(APP_CONFIG) config: AppConfig,
    @Optional() private readonly codes?: SetupCodes,
  ) {
    // Fails the start, not the sign-up: a server of many shops that lost its code check would let
    // a stranger who knows an address make the owner of a shop that is waiting for its own.
    if (config.multiShop && !codes) {
      throw new Error('MULTI_SHOP is on but the sign-up has no setup-code check');
    }
  }

  async status(): Promise<RegistrationStatus> {
    const open = await this.auth.ownerSignupOpen();
    return {
      open,
      ...this.auth.shopAnswer(),
      ...(open && this.codes ? { setupCodeRequired: true as const } : {}),
    };
  }

  /**
   * With a setup code: check it without using it, make the owner and the shop's settings exactly
   * as without one, then mark the code used. All before the request commits, so a failure at any
   * step leaves no owner and a code that was not used.
   */
  async register(request: OwnerRegistrationRequest, client: string): Promise<IssuedTokens> {
    let ticket;
    if (this.codes) {
      // A server that is not taking sign-ups, or a shop that has its owner, refuses before it
      // counts a try or asks the control database (OWNER_SIGNUP_ENABLED=false closes it for the
      // holder of a code too).
      if (!(await this.auth.ownerSignupOpen())) throw signUpClosed();
      ticket = await this.codes.check(request.setupCode, client);
    }
    const issued = await this.registerOwner(request);
    if (this.codes && ticket) await this.codes.use(ticket);
    return issued;
  }

  private registerOwner(request: OwnerRegistrationRequest): Promise<IssuedTokens> {
    const { fullName, email, password } = request;
    return this.auth.registerOwner({ fullName, email, password }, async () => {
      // Since always: the shop has no history before it.
      const first = { effectiveFrom: null };
      await this.settings.put('shop_name', { ...first, value: request.shopName });
      if (request.shopLogo) {
        await this.settings.put('shop_logo', { ...first, value: request.shopLogo });
      }
      await this.settings.put('selling_units', { ...first, value: request.sellingUnits });
      await this.settings.put('money_display_unit', { ...first, value: request.currency });
    });
  }
}
