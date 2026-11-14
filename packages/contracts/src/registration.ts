import { z } from 'zod';
import { newPasswordSchema, USERNAME_PATTERN } from './auth.js';
import { idSchema } from './common.js';
import { photoImageSchema } from './photos.js';
import { sellingUnitsSchema } from './selling-units.js';
import { SETTINGS } from './settings.js';
import { SETUP_CODE_TYPED_MAX } from './setup-code.js';

/** Issue messages for rules zod has no built-in code for; the web shows i18n text for each. */
export const REGISTRATION_ISSUES = {
  passwordMismatch: 'password_mismatch',
  emailCharacters: 'email_characters',
  /** An error's `issues[].code`: the server is not taking sign-ups (an owner exists, or it is off). */
  registrationClosed: 'registration_closed',
  /** An error's `issues[].code`: an account already signs in with this email. */
  emailTaken: 'email_taken',
} as const;

/** The longest owner name (it heads the account menu and the audit log). */
export const OWNER_NAME_MAX = 80;

/** An email address, as the owner signs in with it: lower case, and a form the sign-in accepts. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254))
  .refine((email) => USERNAME_PATTERN.test(email), REGISTRATION_ISSUES.emailCharacters);

/**
 * The first owner setting a shop up (ADR 0023). Nothing here names a role or a shop: the server
 * makes the account the owner's and the settings the shop's, and a field the form does not
 * list is dropped.
 */
export const ownerRegistrationRequestSchema = z
  .object({
    fullName: z.string().trim().min(2).max(OWNER_NAME_MAX),
    email: emailSchema,
    password: newPasswordSchema,
    confirmPassword: z.string().max(256),
    shopName: SETTINGS.shop_name.schema,
    /** The shop's own logo, built on the device as a product photo is (ADR 0009, 0017). */
    shopLogo: photoImageSchema.nullable().default(null),
    sellingUnits: sellingUnitsSchema,
    /** How money is typed and shown; stored amounts are cents either way (SPEC §0). */
    currency: SETTINGS.money_display_unit.schema,
    /**
     * The setup code the operator gave the owner, as typed (ADR 0029). Taken only on a server with
     * many shops, where it is required; a one-shop server ignores it. Any text up to the limit is
     * accepted here, because a wrong code gets the same answer as a closed sign-up, never a
     * message that says what is wrong with it.
     */
    setupCode: z.string().max(SETUP_CODE_TYPED_MAX).optional(),
  })
  .refine((request) => request.password === request.confirmPassword, {
    path: ['confirmPassword'],
    message: REGISTRATION_ISSUES.passwordMismatch,
  });
export type OwnerRegistrationRequest = z.output<typeof ownerRegistrationRequestSchema>;
export type OwnerRegistrationInput = z.input<typeof ownerRegistrationRequestSchema>;

/** Whether `/signup` is open: only on a server that has no owner yet, and not turned off. */
export const registrationStatusSchema = z.object({
  open: z.boolean(),
  /** The shop at this address (ADR 0029); absent on a one-shop server. See `accessTokenResponseSchema`. */
  shopId: idSchema.optional(),
  /**
   * `true` when the shop waits for its owner and the sign-up needs the setup code (ADR 0029). Left
   * out otherwise: on a one-shop server, and when the sign-up is closed.
   */
  setupCodeRequired: z.literal(true).optional(),
});
export type RegistrationStatus = z.infer<typeof registrationStatusSchema>;
