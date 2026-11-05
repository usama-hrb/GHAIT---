import {
  type Account,
  type AccountChange,
  type AccountCredential,
  type AccountListQuery,
  accountChangeSchema,
  accountCredentialSchema,
  accountListQuerySchema,
  accountSchema,
  deactivateAccountSchema,
  type EligiblePartner,
  eligiblePartnerSchema,
  type NewCashierAccount,
  type NewPartnerAccount,
  newCashierAccountSchema,
  newPartnerAccountSchema,
} from '@fabric/contracts';
import { z } from 'zod';
import { parseOrThrow } from './errors';
import { NeedsServerError, type ServerLink } from './settlements';
import type { LocalStore } from './store';

/**
 * The login accounts the owner manages (ADR 0024): cashiers, and the partners' logins. They are
 * the server's, not shop data: nothing is stored on the device and nothing waits in the outbox,
 * because a switched-off account must stop working at once and a temporary password must be shown
 * once and kept nowhere. Every call needs the connection and the owner's session; the server
 * checks both. Named `userAccounts` because `accounts` already means the customers' ledger.
 */
export class UserAccountsRepository {
  constructor(
    private readonly store: LocalStore,
    private readonly server?: ServerLink,
  ) {}

  list(filters: AccountListQuery = {}): Promise<Account[]> {
    const query = parseOrThrow(accountListQuerySchema, filters);
    const params = new URLSearchParams();
    if (query.role) params.set('role', query.role);
    if (query.status) params.set('status', query.status);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.link().request(`/accounts${suffix}`, z.array(accountSchema));
  }

  /** The partners who can be given a login: in the shop, with no active account. */
  eligiblePartners(): Promise<EligiblePartner[]> {
    return this.link().request('/accounts/eligible-partners', z.array(eligiblePartnerSchema));
  }

  /** A cashier account. The server chooses the password; it is in the answer, once. */
  createCashier(input: NewCashierAccount): Promise<AccountCredential> {
    this.store.assertWritable();
    return this.link().request('/accounts/cashiers', accountCredentialSchema, {
      method: 'POST',
      body: parseOrThrow(newCashierAccountSchema, input),
    });
  }

  /** A login for an existing partner. It creates no partner. */
  createPartner(input: NewPartnerAccount): Promise<AccountCredential> {
    this.store.assertWritable();
    return this.link().request('/accounts/partners', accountCredentialSchema, {
      method: 'POST',
      body: parseOrThrow(newPartnerAccountSchema, input),
    });
  }

  /** Switches the account off: it cannot sign in and its devices are signed out now. */
  deactivate(id: string, reason: string): Promise<Account> {
    this.store.assertWritable();
    return this.link().request(`/accounts/${id}/deactivate`, accountSchema, {
      method: 'POST',
      body: parseOrThrow(deactivateAccountSchema, { reason }),
    });
  }

  /** Switches the account on again with a new temporary password. */
  reactivate(id: string, change: Partial<AccountChange> = {}): Promise<AccountCredential> {
    return this.change(id, 'reactivate', change);
  }

  /** A new temporary password for an account that is on; every device of it is signed out. */
  resetCredentials(id: string, change: Partial<AccountChange> = {}): Promise<AccountCredential> {
    return this.change(id, 'reset-credentials', change);
  }

  private change(
    id: string,
    action: 'reactivate' | 'reset-credentials',
    change: Partial<AccountChange>,
  ): Promise<AccountCredential> {
    this.store.assertWritable();
    return this.link().request(`/accounts/${id}/${action}`, accountCredentialSchema, {
      method: 'POST',
      body: parseOrThrow(accountChangeSchema, change),
    });
  }

  private link(): ServerLink {
    if (!this.server) throw new NeedsServerError('Accounts are managed on the server');
    return this.server;
  }
}
