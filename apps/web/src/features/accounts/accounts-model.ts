import {
  ACCOUNT_NAME_MAX,
  type Account,
  type AccountListQuery,
  type Role,
  usernameSchema,
} from '@fabric/contracts';

/** What the filters can be set to: a type or a status, or neither (`all`). */
export type RoleFilter = Role | 'all';
export type StatusFilter = 'active' | 'inactive' | 'all';

export interface AccountFilters {
  role: RoleFilter;
  status: StatusFilter;
}

export const ROLE_FILTERS = [
  'all',
  'cashier',
  'partner',
  'owner',
] as const satisfies readonly RoleFilter[];
export const STATUS_FILTERS = [
  'all',
  'active',
  'inactive',
] as const satisfies readonly StatusFilter[];

export const noFilters = (): AccountFilters => ({ role: 'all', status: 'all' });
export const isFiltered = (filters: AccountFilters): boolean =>
  filters.role !== 'all' || filters.status !== 'all';

/** The query the server takes: a filter left on `all` is not sent. */
export function queryOf(filters: AccountFilters): AccountListQuery {
  return {
    ...(filters.role === 'all' ? {} : { role: filters.role }),
    ...(filters.status === 'all' ? {} : { status: filters.status }),
  };
}

/** What the owner can do to an account. The owner's own account is managed from the command line. */
export type AccountAction = 'deactivate' | 'reactivate' | 'reset';

/**
 * The actions an account offers in its menu: an active one can be switched off or have its
 * password reset, a switched-off one can be switched on again, the owner's none (the server
 * refuses them too). A partner account that was never linked to a partner cannot be switched back
 * on: a new one is made for the partner instead (ADR 0024).
 */
export function actionsOf(account: Account): AccountAction[] {
  if (account.role === 'owner') return [];
  if (account.status === 'active') return ['reset', 'deactivate'];
  if (account.role === 'partner' && account.partner === null) return [];
  return ['reactivate'];
}

/** The text of a field that must be filled, or null. */
export type CashierProblem = 'usernameRequired' | 'usernameInvalid' | 'displayNameRequired';

export interface CashierDraft {
  username: string;
  displayName: string;
}

export const emptyCashierDraft = (): CashierDraft => ({ username: '', displayName: '' });

/**
 * What is wrong with a new account's details; the same rules as the server's (the contract's
 * username and name), so the form never disagrees with it. The username is kept as typed apart
 * from surrounding spaces: the server lower-cases it.
 */
export function accountProblems(
  draft: CashierDraft,
): Partial<Record<keyof CashierDraft, CashierProblem>> {
  const problems: Partial<Record<keyof CashierDraft, CashierProblem>> = {};
  const username = draft.username.trim();
  if (username === '') problems.username = 'usernameRequired';
  else if (!usernameSchema.safeParse(username).success) problems.username = 'usernameInvalid';
  const name = draft.displayName.trim();
  if (name.length < 2 || name.length > ACCOUNT_NAME_MAX)
    problems.displayName = 'displayNameRequired';
  return problems;
}

export const trimmed = (draft: CashierDraft): CashierDraft => ({
  username: draft.username.trim(),
  displayName: draft.displayName.trim(),
});

/** The name an account is called in the screen's sentences. */
export const accountName = (account: Pick<Account, 'displayName' | 'username'>): string =>
  account.displayName.trim() === '' ? account.username : account.displayName;
