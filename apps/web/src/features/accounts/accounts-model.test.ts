import type { Account } from '@fabric/contracts';
import { describe, expect, it } from 'vitest';
import {
  accountName,
  accountProblems,
  actionsOf,
  isFiltered,
  noFilters,
  queryOf,
} from './accounts-model';

const account = (patch: Partial<Account>): Account => ({
  id: '00000000-0000-4000-8000-000000000001',
  username: 'sara',
  displayName: 'Sara',
  role: 'cashier',
  status: 'active',
  deactivatedAt: null,
  createdAt: '2026-11-05T10:00:00.000Z',
  mustChangePassword: false,
  partner: null,
  ...patch,
});

describe('the filters', () => {
  it('send nothing while both are on all', () => {
    expect(queryOf(noFilters())).toEqual({});
    expect(isFiltered(noFilters())).toBe(false);
  });

  it('send only the one that is set, or both', () => {
    expect(queryOf({ role: 'cashier', status: 'all' })).toEqual({ role: 'cashier' });
    expect(queryOf({ role: 'all', status: 'inactive' })).toEqual({ status: 'inactive' });
    expect(queryOf({ role: 'partner', status: 'active' })).toEqual({
      role: 'partner',
      status: 'active',
    });
    expect(isFiltered({ role: 'partner', status: 'all' })).toBe(true);
  });
});

describe('the actions an account offers', () => {
  it('lets an active cashier or partner be reset or switched off', () => {
    expect(actionsOf(account({ role: 'cashier' }))).toEqual(['reset', 'deactivate']);
    expect(
      actionsOf(account({ role: 'partner', partner: { id: 'p', name: 'Amine', exitedOn: null } })),
    ).toEqual(['reset', 'deactivate']);
  });

  it('lets a switched-off account be switched on, and nothing else', () => {
    expect(
      actionsOf(account({ status: 'inactive', deactivatedAt: '2026-11-05T11:00:00.000Z' })),
    ).toEqual(['reactivate']);
  });

  it('offers a partner account that was never linked nothing: a new one is made instead', () => {
    expect(actionsOf(account({ role: 'partner', status: 'inactive', partner: null }))).toEqual([]);
  });

  it('offers the owner’s account nothing', () => {
    expect(actionsOf(account({ role: 'owner' }))).toEqual([]);
  });
});

describe('a new account’s details', () => {
  it('need a username and a name', () => {
    expect(accountProblems({ username: '', displayName: '' })).toEqual({
      username: 'usernameRequired',
      displayName: 'displayNameRequired',
    });
  });

  it('refuse a username the server would refuse, and spaces around do not count', () => {
    expect(accountProblems({ username: 'a b', displayName: 'Sara' })).toEqual({
      username: 'usernameInvalid',
    });
    expect(accountProblems({ username: 'ab', displayName: 'Sara' })).toEqual({
      username: 'usernameInvalid',
    });
    expect(accountProblems({ username: '  sara.till  ', displayName: ' Sara ' })).toEqual({});
  });

  it('refuse a name of one letter or past the limit', () => {
    expect(accountProblems({ username: 'sara', displayName: 'S' })).toEqual({
      displayName: 'displayNameRequired',
    });
    expect(accountProblems({ username: 'sara', displayName: 'x'.repeat(81) })).toEqual({
      displayName: 'displayNameRequired',
    });
  });
});

describe('the name of an account', () => {
  it('is the display name, or the username when it has none', () => {
    expect(accountName(account({}))).toBe('Sara');
    expect(accountName(account({ displayName: ' ' }))).toBe('sara');
  });
});
