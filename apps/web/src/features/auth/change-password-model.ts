import { newPasswordSchema } from '@fabric/contracts';

/** What the person typed on the "choose your own password" screen (ADR 0024). */
export interface ChangePasswordDraft {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export type ChangePasswordField = keyof ChangePasswordDraft;
export type ChangePasswordProblem = 'required' | 'tooShort' | 'mismatch';
export type ChangePasswordProblems = Partial<Record<ChangePasswordField, ChangePasswordProblem>>;

export const emptyChangePasswordDraft = (): ChangePasswordDraft => ({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
});

/**
 * What is wrong with the draft; empty when it may be sent. The length rule is the contract's, so
 * the screen and the server never disagree about it. The server still decides whether the
 * temporary password is the right one and whether the new one differs from it.
 */
export function changePasswordProblems(draft: ChangePasswordDraft): ChangePasswordProblems {
  const problems: ChangePasswordProblems = {};
  if (draft.currentPassword === '') problems.currentPassword = 'required';

  if (draft.newPassword === '') problems.newPassword = 'required';
  else if (!newPasswordSchema.safeParse(draft.newPassword).success)
    problems.newPassword = 'tooShort';

  if (draft.confirmPassword === '') problems.confirmPassword = 'required';
  else if (draft.confirmPassword !== draft.newPassword) problems.confirmPassword = 'mismatch';

  return problems;
}

/**
 * Where a signed-in account goes: the page that makes it choose its own password while it is still
 * on the temporary one, otherwise where it was headed.
 */
export function destinationAfterSignIn(
  user: { mustChangePassword: boolean },
  next: string,
): string {
  return user.mustChangePassword ? '/change-password' : next;
}
