import {
  type AccessTokenResponse,
  accessTokenResponseSchema,
  type AuthUser,
  authUserSchema,
  type LoginRequest,
  loginRequestSchema,
  REFRESH_COOKIE,
} from '@fabric/contracts';
import { Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { ZodBody, ZodResponse } from '../../common/index.js';
import { APP_CONFIG, type AppConfig } from '../../config/index.js';
import { AuditExempt } from '../audit/index.js';
import { type AuthenticatedUser, CurrentUser, Public } from './auth.decorators.js';
import { AuthService, type IssuedTokens } from './auth.service.js';

/**
 * The access token is returned in the body (the web client keeps it in memory); the refresh
 * token only travels in an httpOnly, SameSite=Strict cookie scoped to these routes (OWASP).
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({ refresh: true })
  @Post('login')
  @HttpCode(200)
  @ZodResponse(accessTokenResponseSchema)
  async login(
    @ZodBody(loginRequestSchema) body: LoginRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AccessTokenResponse> {
    const issued = await this.auth.login(body);
    this.setRefreshCookie(response, issued);
    return issued.response;
  }

  @Public()
  @AuditExempt(
    'rotation runs its own transaction: a reused token must revoke its family although the request fails',
  )
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({ login: true })
  @Post('refresh')
  @HttpCode(200)
  @ZodResponse(accessTokenResponseSchema)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AccessTokenResponse> {
    try {
      const issued = await this.auth.refresh(this.refreshTokenOf(request));
      this.setRefreshCookie(response, issued);
      return issued.response;
    } catch (error) {
      response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
      throw error;
    }
  }

  @Public()
  @AuditExempt(
    'revokes and audits in its own transaction; without a session there is nothing to do',
  )
  @Post('logout')
  @HttpCode(204)
  @ApiNoContentResponse()
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(this.refreshTokenOf(request));
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  @ApiBearerAuth()
  @Get('me')
  @ZodResponse(authUserSchema)
  me(@CurrentUser() user: AuthenticatedUser): Promise<AuthUser> {
    return this.auth.me(user.id);
  }

  private refreshTokenOf(request: Request): string | undefined {
    // cookie-parser (configureHttp) fills request.cookies.
    const cookies: Record<string, unknown> = request.cookies;
    const token = cookies[REFRESH_COOKIE];
    return typeof token === 'string' && token !== '' ? token : undefined;
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.auth.cookieSecure,
      sameSite: 'strict',
      path: this.config.auth.cookiePath,
    };
  }

  private setRefreshCookie(response: Response, issued: IssuedTokens): void {
    response.cookie(REFRESH_COOKIE, issued.refreshToken, {
      ...this.cookieOptions(),
      expires: issued.refreshExpiresAt,
    });
  }
}
