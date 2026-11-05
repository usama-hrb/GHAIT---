import { REFRESH_COOKIE } from '@fabric/contracts';
import type { CookieOptions, Response } from 'express';
import type { AppConfig } from '../../config/index.js';
import type { IssuedTokens } from './auth.service.js';

/**
 * The refresh token's cookie: httpOnly, SameSite=Strict, scoped to the auth routes and Secure in
 * production (OWASP). One definition for every route that signs someone in.
 */
export function refreshCookieOptions(config: AppConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: config.auth.cookieSecure,
    sameSite: 'strict',
    path: config.auth.cookiePath,
  };
}

export function setRefreshCookie(
  response: Response,
  config: AppConfig,
  issued: IssuedTokens,
): void {
  response.cookie(REFRESH_COOKIE, issued.refreshToken, {
    ...refreshCookieOptions(config),
    expires: issued.refreshExpiresAt,
  });
}
