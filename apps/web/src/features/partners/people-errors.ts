import type { ValidationIssue } from '@fabric/contracts';
import { messages } from '@/i18n';
import { isPeriodLocked, ReadOnlyError, ValidationError } from '@/local-db';
import { errorsByField, issueMessage } from '@/shared/lib/form-errors';

/** The texts for every issue the people screens can meet: partners, pay, and the profit rules. */
function issueTexts(): Record<string, string> {
  return { ...messages.settlements.issues, ...messages.partners.issues };
}

/**
 * Why a save failed, in words: that this account only reads, that the date is in a closed period,
 * or the first issue the checks found.
 */
export function failureText(error: unknown): string {
  if (error instanceof ReadOnlyError) return messages.auth.readOnly;
  if (isPeriodLocked(error)) return messages.forms.periodLocked;
  if (error instanceof ValidationError) {
    const first = error.issues[0];
    if (first) return issueMessage(first, issueTexts());
  }
  return messages.forms.invalid;
}

/** The issues of a failed save as one message per field, for showing under the fields. */
export function fieldFailures(error: unknown): Record<string, string> {
  return error instanceof ValidationError ? errorsByField(error.issues, issueTexts()) : {};
}

/** What each issue says, in words: why something cannot be done (the reasons shown beside a blocked action). */
export function issueTextsOf(issues: readonly ValidationIssue[]): string[] {
  return issues.map((issue) => issueMessage(issue, issueTexts()));
}
