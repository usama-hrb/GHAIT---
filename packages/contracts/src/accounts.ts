import { z } from 'zod';
import { newPasswordSchema, roleSchema, usernameSchema } from './auth.js';
import { idSchema, isoDateSchema, timestampSchema } from './common.js';

/**
 * Login accounts, as the owner manages them (ADR 0024). A login account is not a business record:
 * making one creates no partner and no employee, and deactivating one removes nothing the shop
 * holds. Nothing in these requests names a role: the route decides it, and a field the form does
 * not list is refused (`.strict()`), so a client cannot ask for more than the route gives.
 */

/** Issue codes of an error's `issues[].code`; the web shows i18n text for each. */
export const ACCOUNT_ISSUES = {
  /** An account already signs in with this username. */
  usernameTaken: 'username_taken',
  /** The partner does not exist, or has been removed. */
  partnerNotFound: 'partner_not_found',
  /** A partner whose login is switched on cannot be removed: switch the login off first. */
  partnerHasLogin: 'partner_has_active_login',
  /** The owner already has the owner's account; a partner login is for the other partners. */
  partnerIsOwner: 'partner_is_owner',
  /** A partner who has left the shop gets no login. */
  partnerExited: 'partner_exited',
  /** The partner already has an active account: at most one. */
  partnerHasAccount: 'partner_has_account',
  /** The owner's account is not managed here (`make owner` resets its password). */
  ownerAccount: 'account_is_owner',
  alreadyActive: 'account_already_active',
  alreadyInactive: 'account_already_inactive',
  /** A partner account made before accounts were linked to a partner cannot be reactivated. */
  notLinked: 'account_not_linked',
  /** Credentials cannot be reset on an account that is switched off. */
  inactive: 'account_inactive',
  /** The account was switched off by the owner; said when the right password is given. */
  deactivated: 'account_deactivated',
  /** The signed-in account must choose its own password first (error code `forbidden`). */
  passwordChangeRequired: 'password_change_required',
  /** The new password is the one the account already has. */
  passwordUnchanged: 'password_unchanged',
  /** The current password is wrong. */
  wrongPassword: 'wrong_password',
} as const;

export const ACCOUNT_STATUSES = ['active', 'inactive'] as const;
export const accountStatusSchema = z.enum(ACCOUNT_STATUSES);
export type AccountStatus = z.infer<typeof accountStatusSchema>;

/** The longest display name (it heads the account menu and the audit log). */
export const ACCOUNT_NAME_MAX = 80;

/** The partner a partner account belongs to, as the owner's list shows it. */
export const linkedPartnerSchema = z.object({
  id: idSchema,
  name: z.string(),
  /** The day they left the shop (S20), when they did: their login is worth a second look. */
  exitedOn: isoDateSchema.nullable(),
});
export type LinkedPartner = z.infer<typeof linkedPartnerSchema>;

export const accountSchema = z.object({
  id: idSchema,
  username: z.string(),
  displayName: z.string(),
  role: roleSchema,
  status: accountStatusSchema,
  /** When it was switched off; null while it is active. */
  deactivatedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  /** Still on the password the owner gave it: the first sign-in asks for a new one. */
  mustChangePassword: z.boolean(),
  /** Set on a partner account only. */
  partner: linkedPartnerSchema.nullable(),
});
export type Account = z.infer<typeof accountSchema>;

export const accountListQuerySchema = z.object({
  role: roleSchema.optional(),
  status: accountStatusSchema.optional(),
});
export type AccountListQuery = z.infer<typeof accountListQuerySchema>;

/** A partner who can be given a login: still in the shop, not the owner, with no active account. */
export const eligiblePartnerSchema = z.object({
  id: idSchema,
  name: z.string(),
  title: z.string().nullable(),
});
export type EligiblePartner = z.infer<typeof eligiblePartnerSchema>;

const accountFields = {
  username: usernameSchema,
  displayName: z.string().trim().min(2).max(ACCOUNT_NAME_MAX),
};

/** A cashier's account: no partner, no limit on how many. */
export const newCashierAccountSchema = z.object(accountFields).strict();
export type NewCashierAccount = z.output<typeof newCashierAccountSchema>;

/** A login for an existing partner. The partner is the only thing it can be linked to. */
export const newPartnerAccountSchema = z.object({ ...accountFields, partnerId: idSchema }).strict();
export type NewPartnerAccount = z.output<typeof newPartnerAccountSchema>;

/** The reason is kept in the audit log with the change. */
export const deactivateAccountSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();
export type DeactivateAccount = z.output<typeof deactivateAccountSchema>;

export const accountChangeSchema = z
  .object({ reason: z.string().trim().max(500).nullable().default(null) })
  .strict();
export type AccountChange = z.output<typeof accountChangeSchema>;

/**
 * An account the owner made or reset, with the one-time password the server generated. The
 * password is shown once and never stored in the clear: the account must replace it at its first
 * sign-in (`mustChangePassword`).
 */
export const accountCredentialSchema = z.object({
  account: accountSchema,
  temporaryPassword: z.string(),
});
export type AccountCredential = z.infer<typeof accountCredentialSchema>;

/** Choosing one's own password: the temporary one, then the one to keep. */
export const changePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: newPasswordSchema,
    confirmPassword: z.string().max(256),
  })
  .strict()
  .refine((request) => request.newPassword === request.confirmPassword, {
    path: ['confirmPassword'],
    message: 'password_mismatch',
  });
export type ChangePasswordRequest = z.output<typeof changePasswordRequestSchema>;
export type ChangePasswordInput = z.input<typeof changePasswordRequestSchema>;

/**
 * The account an owner makes for someone who is not at the shop: server-generated, 16 letters and
 * digits without the look-alikes (0/O, 1/l/I), in four groups. About 90 bits.
 */
export const TEMPORARY_PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export const TEMPORARY_PASSWORD_GROUPS = 4;
export const TEMPORARY_PASSWORD_GROUP_SIZE = 4;
