import {
  capitalMoveSchema,
  idSchema,
  type NewCapitalMoveInput,
  newCapitalMoveSchema,
  type NewPartnerDrawInput,
  newPartnerDrawSchema,
  type PartnerInput,
  partnerDrawSchema,
  partnerInputSchema,
  partnerSchema,
  type VoidRequest,
  voidRequestSchema,
} from '@fabric/contracts';
import { Controller, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AppHttpException, OwnerOnly, ZodBody, ZodParam, ZodResponse } from '../../common/index.js';
import { type AuthenticatedUser, CurrentUser } from '../auth/index.js';
import { PartnersService } from './partners.service.js';

const withServerSeq = { serverSeq: z.int().positive() };
const storedPartner = partnerSchema.extend(withServerSeq);
const storedCapitalMove = capitalMoveSchema.extend(withServerSeq);
const storedDraw = partnerDrawSchema.extend(withServerSeq);
const accountSchema = z.object({
  partnerId: idSchema,
  account: z.object({
    capitalCents: z.int(),
    contributionsCents: z.int(),
    retainedProfitCents: z.int(),
    withdrawalsCents: z.int(),
    sharesCents: z.int(),
    drawsCents: z.int(),
    undrawnCents: z.int(),
  }),
});

/** REST access to the partners and their money; the web app does the same offline through sync. */
@ApiTags('partners')
@ApiBearerAuth()
@Controller()
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  /** Their phone numbers and notes are in it: a partner reads the partners through sync (ADR 0024). */
  @OwnerOnly()
  @Get('partners')
  @ZodResponse(z.array(storedPartner))
  list() {
    return this.partners.list();
  }

  @Put('partners/:id')
  @ZodResponse(storedPartner)
  put(@ZodParam('id', idSchema) id: string, @ZodBody(partnerInputSchema) body: PartnerInput) {
    return this.partners.putPartner(id, body);
  }

  /** Removes a partner who took part in nothing; the owner and anyone with a history stay (S19). */
  @Post('partners/:id/void')
  @HttpCode(200)
  @ZodResponse(storedPartner)
  voidPartner(@ZodParam('id', idSchema) id: string, @ZodBody(voidRequestSchema) body: VoidRequest) {
    return this.partners.void('partner', id, body.reason);
  }

  /**
   * Capital, retained profit, draws and the undrawn share, from the records (SPEC §6, §8.4). A
   * partner's account reads its own partner's, and no other (ADR 0024, PS3).
   */
  @Get('partners/:id/account')
  @ZodResponse(accountSchema)
  account(@ZodParam('id', idSchema) id: string, @CurrentUser() user: AuthenticatedUser) {
    if (user.role === 'partner' && user.partnerId !== id) {
      throw new AppHttpException(
        'forbidden',
        "A partner account reads its own partner's account only",
        HttpStatus.FORBIDDEN,
      );
    }
    return this.partners.account(id);
  }

  /** A contribution, or a withdrawal (with its reason); never edited afterwards. */
  @Put('capital-moves/:id')
  @ZodResponse(storedCapitalMove)
  capitalMove(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(newCapitalMoveSchema) body: NewCapitalMoveInput,
  ) {
    return this.partners.recordCapitalMove(id, body);
  }

  @Post('capital-moves/:id/void')
  @HttpCode(200)
  @ZodResponse(storedCapitalMove)
  voidCapitalMove(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(voidRequestSchema) body: VoidRequest,
  ) {
    return this.partners.void('capital_move', id, body.reason);
  }

  @Put('partner-draws/:id')
  @ZodResponse(storedDraw)
  draw(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(newPartnerDrawSchema) body: NewPartnerDrawInput,
  ) {
    return this.partners.recordDraw(id, body);
  }

  @Post('partner-draws/:id/void')
  @HttpCode(200)
  @ZodResponse(storedDraw)
  voidDraw(@ZodParam('id', idSchema) id: string, @ZodBody(voidRequestSchema) body: VoidRequest) {
    return this.partners.void('partner_draw', id, body.reason);
  }
}
