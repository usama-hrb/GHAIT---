import { z } from 'zod';
import { idSchema } from './common.js';

/** SPEC §11: the owner now; a partner (sees the same numbers) and a cashier (no cost/profit) later. */
export const ROLES = ['owner', 'partner', 'cashier'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, 'letters, digits, dot, dash or underscore; 3 to 32');

/** A new password (OWASP: length over composition rules; no upper bound below 64). */
export const newPasswordSchema = z.string().min(12).max(256);

export const loginRequestSchema = z.object({
  username: usernameSchema,
  // Any length on login: a policy change must not lock out an existing password.
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const authUserSchema = z.object({
  id: idSchema,
  username: z.string(),
  displayName: z.string(),
  role: roleSchema,
});
export type AuthUser = z.infer<typeof authUserSchema>;

/** The access token travels in the body; the refresh token only in an httpOnly cookie. */
export const accessTokenResponseSchema = z.object({
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  /** Seconds until the access token expires. */
  expiresIn: z.int().positive(),
  user: authUserSchema,
});
export type AccessTokenResponse = z.infer<typeof accessTokenResponseSchema>;

/** Name of the refresh-token cookie (httpOnly, SameSite=Strict, scoped to the auth routes). */
export const REFRESH_COOKIE = 'fabric_refresh';
