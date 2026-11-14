import { REGISTRATION_ISSUES } from '@fabric/contracts';
import { describe, expect, it } from 'vitest';
import {
  accountProblems,
  emptyDraft,
  firstInvalidStep,
  passwordStrength,
  registrationFailureOf,
  registrationRequestOf,
  shopProblem,
  stepIsValid,
  unitsProblem,
} from './registration-model';

const valid = () => ({
  ...emptyDraft(),
  fullName: 'Amina Alaoui',
  email: 'amina@example.com',
  password: 'a-long-enough-password',
  confirmPassword: 'a-long-enough-password',
  shopName: 'Al Nour',
  units: { piece: false, kg: false, meter: true },
});

describe('accountProblems', () => {
  it('asks for every field on an empty draft', () => {
    expect(accountProblems(emptyDraft())).toEqual({
      fullName: 'required',
      email: 'required',
      password: 'required',
      confirmPassword: 'required',
    });
  });

  it('accepts a complete account', () => {
    expect(accountProblems(valid())).toEqual({});
  });

  it('tells a malformed email from one the sign-in cannot take', () => {
    expect(accountProblems({ ...valid(), email: 'not-an-email' }).email).toBe('invalid');
    expect(accountProblems({ ...valid(), email: 'amina@@example.com' }).email).toBe('invalid');
    expect(accountProblems({ ...valid(), email: "o'neil@example.com" }).email).toBe('characters');
  });

  it('treats the email case and edge spaces as the server does', () => {
    expect(accountProblems({ ...valid(), email: '  Amina@Example.COM ' })).toEqual({});
  });

  it('wants 12 characters', () => {
    const short = { ...valid(), password: 'elevenchars', confirmPassword: 'elevenchars' };
    expect(accountProblems(short).password).toBe('tooShort');
  });

  it('wants the two passwords to match', () => {
    expect(accountProblems({ ...valid(), confirmPassword: 'another-password-1' })).toEqual({
      confirmPassword: 'mismatch',
    });
  });

  it('wants a name of two characters', () => {
    expect(accountProblems({ ...valid(), fullName: ' A ' }).fullName).toBe('required');
  });
});

describe('shop and selling steps', () => {
  it('requires a shop name, not only spaces', () => {
    expect(shopProblem({ ...valid(), shopName: '   ' })).toBe('required');
    expect(shopProblem(valid())).toBeNull();
  });

  it('never needs a logo', () => {
    expect(shopProblem({ ...valid(), logo: null })).toBeNull();
  });

  it('accepts every combination of the three units except none', () => {
    for (const piece of [false, true]) {
      for (const kg of [false, true]) {
        for (const meter of [false, true]) {
          const draft = { ...valid(), units: { piece, kg, meter } };
          expect(unitsProblem(draft)).toBe(piece || kg || meter ? null : 'none');
        }
      }
    }
  });

  it('starts with every unit off, so the owner chooses', () => {
    expect(emptyDraft().units).toEqual({ piece: false, kg: false, meter: false });
    expect(unitsProblem(emptyDraft())).toBe('none');
  });
});

describe('stepIsValid and firstInvalidStep', () => {
  it('has no invalid step on a complete draft', () => {
    expect(firstInvalidStep(valid())).toBeNull();
  });

  it('points at the first step that cannot be sent', () => {
    expect(firstInvalidStep(emptyDraft())).toBe('account');
    expect(firstInvalidStep({ ...valid(), shopName: '' })).toBe('shop');
    expect(firstInvalidStep({ ...valid(), units: { piece: false, kg: false, meter: false } })).toBe(
      'selling',
    );
  });

  it('has nothing of its own to check on the review step', () => {
    expect(stepIsValid('review', emptyDraft())).toBe(true);
  });
});

describe('passwordStrength', () => {
  it('is weak under 12 characters or with almost no variety', () => {
    expect(passwordStrength('')).toBe('weak');
    expect(passwordStrength('Short-1')).toBe('weak');
    expect(passwordStrength('aaaaaaaaaaaaaaaaaaaa')).toBe('weak');
  });

  it('grows with length, mix and variety', () => {
    expect(passwordStrength('abcdefghijkl')).toBe('fair');
    expect(passwordStrength('Correct-Horse-9')).toBe('good');
    expect(passwordStrength('correct horse battery staple')).toBe('strong');
  });
});

describe('registrationRequestOf', () => {
  it('sends the draft as the API takes it', () => {
    const request = registrationRequestOf({
      ...valid(),
      fullName: '  Amina Alaoui ',
      email: ' Amina@Example.com ',
      shopName: ' Al Nour ',
      currency: 'dirham',
    });
    expect(request).toEqual({
      fullName: 'Amina Alaoui',
      email: 'amina@example.com',
      password: 'a-long-enough-password',
      confirmPassword: 'a-long-enough-password',
      shopName: 'Al Nour',
      shopLogo: null,
      sellingUnits: { piece: false, kg: false, meter: true },
      currency: 'dirham',
    });
  });

  it('names no role', () => {
    expect(Object.keys(registrationRequestOf(valid()))).not.toContain('role');
  });
});

describe('the setup code', () => {
  const withCode = (setupCode: string) => ({ ...valid(), setupCode });

  it('is not asked for unless the shop asks for it', () => {
    expect(accountProblems(valid())).toEqual({});
    expect(accountProblems(valid(), false)).toEqual({});
    expect(stepIsValid('account', valid())).toBe(true);
    expect(firstInvalidStep(valid())).toBeNull();
  });

  it('is required when the shop asks for it', () => {
    expect(accountProblems(valid(), true)).toEqual({ setupCode: 'required' });
    expect(accountProblems(withCode('   '), true)).toEqual({ setupCode: 'required' });
    expect(stepIsValid('account', valid(), true)).toBe(false);
    expect(firstInvalidStep(valid(), true)).toBe('account');
  });

  it('is judged by its shape, read as the server reads it', () => {
    expect(accountProblems(withCode('ABCD-EFGH'), true).setupCode).toBe('invalid');
    expect(accountProblems(withCode('ABCD-EFGH-JKMN-P'), true).setupCode).toBe('invalid');
    expect(accountProblems(withCode('ABCD-EFGH-JKM!'), true).setupCode).toBe('invalid');
    for (const typed of ['ABCDEFGHJKMN', 'abcd-efgh-jkmn', ' ABCD EFGH JKMN ', 'oilo-0000-0000']) {
      expect(accountProblems(withCode(typed), true)).toEqual({});
    }
    expect(firstInvalidStep(withCode('abcd-efgh-jkmn'), true)).toBeNull();
  });

  it('goes in the request only when the shop asks for it, as typed but for the edge spaces', () => {
    const typed = withCode('  abcd-efgh-jkmn ');
    expect(registrationRequestOf(typed, true).setupCode).toBe('abcd-efgh-jkmn');
    expect(Object.keys(registrationRequestOf(typed))).not.toContain('setupCode');
    expect(Object.keys(registrationRequestOf(typed, false))).not.toContain('setupCode');
  });
});

describe('registrationFailureOf', () => {
  it('reads the server issue codes', () => {
    expect(
      registrationFailureOf({
        network: false,
        code: 'conflict',
        issues: [{ code: REGISTRATION_ISSUES.emailTaken }],
      }),
    ).toBe('email_taken');
    expect(
      registrationFailureOf({
        network: false,
        code: 'forbidden',
        issues: [{ code: REGISTRATION_ISSUES.registrationClosed }],
      }),
    ).toBe('registration_closed');
  });

  it('maps the other known failures and falls back to unknown', () => {
    expect(registrationFailureOf({ network: true })).toBe('network');
    expect(registrationFailureOf({ network: false, code: 'too_many_requests' })).toBe(
      'too_many_requests',
    );
    expect(registrationFailureOf({ network: false, code: 'validation_failed' })).toBe(
      'validation_failed',
    );
    expect(registrationFailureOf({ network: false, code: 'internal' })).toBe('unknown');
  });
});
