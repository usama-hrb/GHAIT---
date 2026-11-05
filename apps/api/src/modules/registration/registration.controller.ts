import {
  type AccessTokenResponse,
  accessTokenResponseSchema,
  type OwnerRegistrationRequest,
  ownerRegistrationRequestSchema,
  type RegistrationStatus,
  registrationStatusSchema,
} from '@fabric/contracts';
import { Controller, Get, HttpCode, Inject, Post, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { ZodBody, ZodResponse } from '../../common/index.js';
import { APP_CONFIG, type AppConfig } from '../../config/index.js';
import { Public, setRefreshCookie } from '../auth/index.js';
import { RegistrationService } from './registration.service.js';

/** The first owner's sign-up page talks to these two routes (ADR 0023). */
@ApiTags('auth')
@Controller('auth')
export class RegistrationController {
  constructor(
    private readonly registration: RegistrationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Open only while the server has no owner; the login page uses it to show or hide the link. */
  @Public()
  @Get('registration')
  @ZodResponse(registrationStatusSchema)
  status(): Promise<RegistrationStatus> {
    return this.registration.status();
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({ login: true, refresh: true })
  @Post('register')
  @HttpCode(201)
  @ZodResponse(accessTokenResponseSchema)
  async register(
    @ZodBody(ownerRegistrationRequestSchema) body: OwnerRegistrationRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AccessTokenResponse> {
    const issued = await this.registration.register(body);
    setRefreshCookie(response, this.config, issued);
    return issued.response;
  }
}
