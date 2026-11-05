import {
  type OwnerRegistrationInput,
  type PhotoImage,
  REGISTRATION_ISSUES,
  type SellingUnits,
  emailSchema,
  newPasswordSchema,
  sellingUnitsSchema,
} from '@fabric/contracts';

/** The sign-up steps, in order (ADR 0023). */
export const SIGNUP_STEPS = ['account', 'shop', 'selling', 'review'] as const;
export type SignupStep = (typeof SIGNUP_STEPS)[number];

export type MoneyUnitChoice = 'rial' | 'dirham';

/** Everything the owner has typed or picked so far; nothing is sent before the last step. */
export interface SignupDraft {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
  shopName: string;
  /** The logo, already made small on this device; null: the built-in mark. */
  logo: PhotoImage | null;
  units: SellingUnits;
  currency: MoneyUnitChoice;
}

/**
 * A new draft. Every unit starts off, so the owner chooses what the shop works in instead of
 * inheriting a preset; the selling step does not continue until one is on. The currency starts as
 * the app's own default (rial, SPEC §0.2).
 */
export function emptyDraft(): SignupDraft {
  return {
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    shopName: '',
    logo: null,
    units: { piece: false, kg: false, meter: false },
    currency: 'rial',
  };
}

export type AccountField = 'fullName' | 'email' | 'password' | 'confirmPassword';
export type AccountProblem = 'required' | 'invalid' | 'characters' | 'tooShort' | 'mismatch';
export type AccountProblems = Partial<Record<AccountField, AccountProblem>>;

/** What is wrong with the account step; empty when it may continue. */
export function accountProblems(draft: SignupDraft): AccountProblems {
  const problems: AccountProblems = {};
  if (draft.fullName.trim().length < 2) problems.fullName = 'required';

  if (draft.email.trim() === '') {
    problems.email = 'required';
  } else {
    const parsed = emailSchema.safeParse(draft.email);
    if (!parsed.success) {
      problems.email = parsed.error.issues.some(
        (issue) => issue.message === REGISTRATION_ISSUES.emailCharacters,
      )
        ? 'characters'
        : 'invalid';
    }
  }

  if (draft.password === '') problems.password = 'required';
  else if (!newPasswordSchema.safeParse(draft.password).success) problems.password = 'tooShort';

  if (draft.confirmPassword === '') problems.confirmPassword = 'required';
  else if (draft.confirmPassword !== draft.password) problems.confirmPassword = 'mismatch';

  return problems;
}

/** The shop step has one required field: the name. */
export function shopProblem(draft: SignupDraft): 'required' | null {
  return draft.shopName.trim() === '' ? 'required' : null;
}

/** The selling step: at least one unit on (the server refuses none too). */
export function unitsProblem(draft: SignupDraft): 'none' | null {
  return sellingUnitsSchema.safeParse(draft.units).success ? null : 'none';
}

/** Whether a step's own fields are all fine. The review step has none of its own. */
export function stepIsValid(step: SignupStep, draft: SignupDraft): boolean {
  switch (step) {
    case 'account':
      return Object.keys(accountProblems(draft)).length === 0;
    case 'shop':
      return shopProblem(draft) === null;
    case 'selling':
      return unitsProblem(draft) === null;
    case 'review':
      return true;
  }
}

/** The first step that cannot be sent as it is, or null: the draft is ready to create the shop. */
export function firstInvalidStep(draft: SignupDraft): SignupStep | null {
  return SIGNUP_STEPS.find((step) => !stepIsValid(step, draft)) ?? null;
}

export type PasswordStrength = 'weak' | 'fair' | 'good' | 'strong';

/**
 * A rough hint for the person typing, never a rule: the server only requires 12 characters.
 * Length counts most, then a mix of letters, digits and symbols, then variety (a run of one
 * character is weak at any length).
 */
export function passwordStrength(password: string): PasswordStrength {
  // Length is counted as the server counts it (UTF-16 units), so "12 characters" means the same.
  const length = password.length;
  const variety = new Set(password).size;
  if (length < 12 || variety < 6) return 'weak';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((pattern) =>
    pattern.test(password),
  ).length;
  const score =
    Number(length >= 16) + Number(length >= 20) + Number(classes >= 3) + Number(variety >= 10);
  return score <= 1 ? 'fair' : score === 2 ? 'good' : 'strong';
}

/** The request body: the draft as the API takes it (it checks every rule again). */
export function registrationRequestOf(draft: SignupDraft): OwnerRegistrationInput {
  return {
    fullName: draft.fullName.trim(),
    email: draft.email.trim().toLowerCase(),
    password: draft.password,
    confirmPassword: draft.confirmPassword,
    shopName: draft.shopName.trim(),
    shopLogo: draft.logo,
    sellingUnits: draft.units,
    currency: draft.currency,
  };
}

export type RegistrationFailure =
  | 'email_taken'
  | 'registration_closed'
  | 'too_many_requests'
  | 'validation_failed'
  | 'network'
  | 'unknown';

/** What the sign-up screen tells the owner when the server did not create the shop. */
export function registrationFailureOf(error: {
  network: boolean;
  code?: string;
  issues?: readonly { code?: string }[];
}): RegistrationFailure {
  if (error.network) return 'network';
  const issueCodes = (error.issues ?? []).map((issue) => issue.code);
  if (issueCodes.includes(REGISTRATION_ISSUES.emailTaken)) return 'email_taken';
  if (issueCodes.includes(REGISTRATION_ISSUES.registrationClosed)) return 'registration_closed';
  if (error.code === 'too_many_requests') return 'too_many_requests';
  if (error.code === 'validation_failed') return 'validation_failed';
  return 'unknown';
}
