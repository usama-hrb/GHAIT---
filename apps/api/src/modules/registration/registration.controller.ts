import {
  type AccessTokenResponse,
  accessTokenResponseSchema,
  type OwnerRegistrationRequest,
  ownerRegistrationRequestSchema,
  type RegistrationStatus,
  registrationStatusSchema,
} from '@fabric/contracts';
import { Controller, Get, HttpCode, Inject, Ip, Post, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ZodBody, ZodResponse } from '../../common/index.js';
import { APP_CONFIG, type AppConfig } from '../../config/index.js';
import { Public, setRefreshCookie, ShopThrottlerGuard } from '../auth/index.js';
import { RegistrationService } from './registration.service.js';

/** The first owner's sign-up page talks to these two routes (ADR 0023). */
@ApiTags('auth')
@Controller('auth')
export class RegistrationController {
  constructor(
    private readonly registration: RegistrationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Open only while the server has no owner; the login page uses it to show or hide the link. On a
   * server of many shops it also says when the sign-up needs the shop's setup code (ADR 0029).
   */
  @Public()
  @Get('registration')
  @ZodResponse(registrationStatusSchema)
  status(): Promise<RegistrationStatus> {
    return this.registration.status();
  }

  @Public()
  @UseGuards(ShopThrottlerGuard)
  @SkipThrottle({ login: true, refresh: true })
  @Post('register')
  @HttpCode(201)
  @ZodResponse(accessTokenResponseSchema)
  async register(
    @ZodBody(ownerRegistrationRequestSchema) body: OwnerRegistrationRequest,
    @Ip() client: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AccessTokenResponse> {
    const issued = await this.registration.register(body, client);
    setRefreshCookie(response, this.config, issued);
    return issued.response;
  }
}
