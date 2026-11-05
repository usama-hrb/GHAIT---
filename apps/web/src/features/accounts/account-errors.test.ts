import { beforeEach, describe, expect, it } from 'vitest';
import { setLanguage } from '@/i18n';
import { ApiError, NeedsServerError, NetworkError, ValidationError } from '@/local-db';
import { accountFailure } from './account-errors';

beforeEach(() => {
  setLanguage('en', { persist: false });
});

describe('why an account request failed', () => {
  it('puts a taken username under the username field and says so', () => {
    const failure = accountFailure(
      new ApiError(409, 'conflict', 'x', [
        { path: ['username'], message: 'username_taken', code: 'username_taken' },
      ]),
    );
    expect(failure.message).toBe('This username is already used by another account.');
    expect(failure.fields).toEqual({ username: failure.message });
  });

  it('names the rule when a partner already has an account', () => {
    const failure = accountFailure(
      new ApiError(409, 'conflict', 'x', [
        { path: ['partnerId'], message: 'partner_has_account', code: 'partner_has_account' },
      ]),
    );
    expect(failure.message).toBe('This partner already has an active account.');
    expect(failure.fields).toEqual({ partnerId: failure.message });
  });

  it('says there is no connection when the server cannot be reached, and that nothing changed otherwise', () => {
    expect(accountFailure(new NetworkError('down')).message).toMatch(/internet/);
    expect(accountFailure(new NeedsServerError('no server')).message).toMatch(/internet/);
    expect(accountFailure(new Error('boom')).message).toMatch(/Nothing was changed/);
  });

  it('answers a refusal by its kind when the server names no rule', () => {
    expect(accountFailure(new ApiError(403, 'forbidden', 'x')).message).toBe(
      'Only the owner can do this.',
    );
    expect(accountFailure(new ApiError(404, 'not_found', 'x')).message).toBe(
      'This account no longer exists.',
    );
    expect(accountFailure(new ValidationError([])).message).toBe(
      'The server did not accept these details.',
    );
  });

  it('speaks Arabic when Arabic is shown', () => {
    setLanguage('ar', { persist: false });
    expect(accountFailure(new ApiError(403, 'forbidden', 'x')).message).toBe(
      'المالك وحده يستطيع ذلك.',
    );
  });
});
