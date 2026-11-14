import { z } from 'zod';
import { idSchema } from './common.js';

/** SPEC §11: the owner now; a partner (sees the same numbers) and a cashier (no cost/profit) later. */
export const ROLES = ['owner', 'partner', 'cashier'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

/**
 * What a user signs in with: a short name (`owner`, a cashier's) or an email address, which is how
 * an owner who registered on the web signs in. Lower case, so the two spellings of one address
 * are one account.
 */
export const USERNAME_PATTERN = /^[a-z0-9._@+-]{3,254}$/;

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(USERNAME_PATTERN, 'letters, digits, dot, dash, underscore, @ or +; 3 to 254');

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
  /**
   * The owner gave this account a temporary password (ADR 0024): until it is replaced the server
   * answers every route but `me` and the password change with `password_change_required`. The
   * default keeps a user a device saved before this field existed.
   */
  mustChangePassword: z.boolean().default(false),
});
export type AuthUser = z.infer<typeof authUserSchema>;

/** The access token travels in the body; the refresh token only in an httpOnly cookie. */
export const accessTokenResponseSchema = z.object({
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  /** Seconds until the access token expires. */
  expiresIn: z.int().positive(),
  user: authUserSchema,
  /**
   * The shop this server answered for (ADR 0029), so a device never mixes two shops: it keeps the
   * first one it signs in to and stops syncing when another one answers. Absent on a one-shop
   * server (`MULTI_SHOP` off), and then nothing is checked.
   */
  shopId: idSchema.optional(),
});
export type AccessTokenResponse = z.infer<typeof accessTokenResponseSchema>;

/** Name of the refresh-token cookie (httpOnly, SameSite=Strict, scoped to the auth routes). */
export const REFRESH_COOKIE = 'fabric_refresh';
