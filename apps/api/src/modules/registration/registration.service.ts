import { type OwnerRegistrationRequest, type RegistrationStatus } from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { AuthService, type IssuedTokens } from '../auth/index.js';
import { SettingsService } from '../settings/index.js';

/**
 * The first owner setting a shop up (ADR 0023): the account (AuthService) and the shop's
 * settings, in the one transaction of the request, so a failure leaves neither.
 */
@Injectable()
export class RegistrationService {
  constructor(
    private readonly auth: AuthService,
    private readonly settings: SettingsService,
  ) {}

  async status(): Promise<RegistrationStatus> {
    return { open: await this.auth.ownerSignupOpen() };
  }

  register(request: OwnerRegistrationRequest): Promise<IssuedTokens> {
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
