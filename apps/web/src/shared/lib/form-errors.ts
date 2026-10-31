import type { ValidationIssue } from '@fabric/contracts';
import { messages } from '@/i18n';

/**
 * A contract issue as a message under its field. `custom` maps a feature's own issue codes
 * (e.g. CATALOG_ISSUES) to text; zod's generic codes get generic text.
 */
export function issueMessage(
  issue: ValidationIssue,
  custom: Readonly<Record<string, string>> = {},
): string {
  const own = custom[issue.message];
  if (own) return own;
  // A record dated in a settled period (BUILD_PROMPTS 4.3), whatever the form.
  if (issue.message === 'period_locked') return messages.forms.periodLocked;
  switch (issue.code) {
    case 'invalid_type':
    case 'too_small':
      return messages.forms.required;
    case 'too_big':
      return messages.forms.tooLong;
    default:
      return messages.forms.invalid;
  }
}

/** The first issue of each top-level field, as messages keyed by field name. */
export function errorsByField(
  issues: readonly ValidationIssue[],
  custom?: Readonly<Record<string, string>>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && !(field in errors))
      errors[field] = issueMessage(issue, custom);
  }
  return errors;
}
