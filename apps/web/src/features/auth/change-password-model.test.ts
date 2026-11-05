import { describe, expect, it } from 'vitest';
import {
  changePasswordProblems,
  destinationAfterSignIn,
  emptyChangePasswordDraft,
} from './change-password-model';

const draft = (patch: Partial<ReturnType<typeof emptyChangePasswordDraft>>) => ({
  ...emptyChangePasswordDraft(),
  ...patch,
});

describe('the change-password draft', () => {
  it('asks for all three fields', () => {
    expect(changePasswordProblems(emptyChangePasswordDraft())).toEqual({
      currentPassword: 'required',
      newPassword: 'required',
      confirmPassword: 'required',
    });
  });

  it('refuses a new password under twelve characters, as the server does', () => {
    const problems = changePasswordProblems(
      draft({
        currentPassword: 'Abcd-Efgh-2345-Wxyz',
        newPassword: 'short-pass',
        confirmPassword: 'short-pass',
      }),
    );
    expect(problems).toEqual({ newPassword: 'tooShort' });
  });

  it('accepts exactly twelve characters', () => {
    const twelve = 'a'.repeat(12);
    expect(
      changePasswordProblems(
        draft({ currentPassword: 'x', newPassword: twelve, confirmPassword: twelve }),
      ),
    ).toEqual({});
  });

  it('flags a confirmation that differs, and only that', () => {
    expect(
      changePasswordProblems(
        draft({
          currentPassword: 'x',
          newPassword: 'a long enough phrase',
          confirmPassword: 'a long enough phrasf',
        }),
      ),
    ).toEqual({ confirmPassword: 'mismatch' });
  });
});

describe('where a signed-in account goes next', () => {
  it('sends an account on its temporary password to choose its own, whatever it asked for', () => {
    expect(destinationAfterSignIn({ mustChangePassword: true }, '/pos')).toBe('/change-password');
  });

  it('keeps the page asked for otherwise', () => {
    expect(destinationAfterSignIn({ mustChangePassword: false }, '/pos')).toBe('/pos');
  });
});
