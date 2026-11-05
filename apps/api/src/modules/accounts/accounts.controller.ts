import {
  type Account,
  type AccountChange,
  type AccountCredential,
  type AccountListQuery,
  accountChangeSchema,
  accountCredentialSchema,
  accountListQuerySchema,
  accountSchema,
  type DeactivateAccount,
  deactivateAccountSchema,
  type EligiblePartner,
  eligiblePartnerSchema,
  idSchema,
  type NewCashierAccount,
  type NewPartnerAccount,
  newCashierAccountSchema,
  newPartnerAccountSchema,
} from '@fabric/contracts';
import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { OwnerOnly, ZodBody, ZodParam, ZodQuery, ZodResponse } from '../../common/index.js';
import { AccountsService } from './accounts.service.js';

/**
 * The owner's account management (ADR 0024). Owner only, reads included: the list names every
 * login and the partner each belongs to. The role of a new account is the route's (`cashiers`,
 * `partners`); no request carries one, and a field a request should not carry is refused.
 */
@ApiTags('accounts')
@ApiBearerAuth()
@OwnerOnly()
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @ZodResponse(z.array(accountSchema))
  list(@ZodQuery(accountListQuerySchema) query: AccountListQuery): Promise<Account[]> {
    return this.accounts.list(query);
  }

  /** Partners who can be given a login: in the shop, not the owner, with no active account. */
  @Get('eligible-partners')
  @ZodResponse(z.array(eligiblePartnerSchema))
  eligiblePartners(): Promise<EligiblePartner[]> {
    return this.accounts.eligiblePartners();
  }

  @Post('cashiers')
  @HttpCode(201)
  @ZodResponse(accountCredentialSchema)
  createCashier(
    @ZodBody(newCashierAccountSchema) body: NewCashierAccount,
  ): Promise<AccountCredential> {
    return this.accounts.createCashier(body);
  }

  @Post('partners')
  @HttpCode(201)
  @ZodResponse(accountCredentialSchema)
  createPartner(
    @ZodBody(newPartnerAccountSchema) body: NewPartnerAccount,
  ): Promise<AccountCredential> {
    return this.accounts.createPartner(body);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @ZodResponse(accountSchema)
  deactivate(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(deactivateAccountSchema) body: DeactivateAccount,
  ): Promise<Account> {
    return this.accounts.deactivate(id, body);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @ZodResponse(accountCredentialSchema)
  reactivate(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(accountChangeSchema) body: AccountChange,
  ): Promise<AccountCredential> {
    return this.accounts.reactivate(id, body);
  }

  @Post(':id/reset-credentials')
  @HttpCode(200)
  @ZodResponse(accountCredentialSchema)
  resetCredentials(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(accountChangeSchema) body: AccountChange,
  ): Promise<AccountCredential> {
    return this.accounts.resetCredentials(id, body);
  }
}
