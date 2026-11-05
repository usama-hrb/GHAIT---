import type { ValidationIssue } from '@fabric/contracts';
import { messages } from '@/i18n';
import {
  ApiError,
  NeedsServerError,
  NetworkError,
  ReadOnlyError,
  ValidationError,
} from '@/local-db';

/** Why a request failed, in words: one message, and the ones that belong under a field. */
export interface AccountFailure {
  message: string;
  fields: Record<string, string>;
}

/** The text for an issue the accounts API reports, by its code (or its message, the same string). */
function issueText(issue: ValidationIssue): string | undefined {
  const known = messages.userAccounts.issues as Record<string, string>;
  return known[issue.code] ?? known[issue.message];
}

function fieldsOf(issues: readonly ValidationIssue[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    const text = issueText(issue);
    if (typeof field === 'string' && text !== undefined && !(field in fields)) fields[field] = text;
  }
  return fields;
}

/**
 * What to tell the owner when an account request fails. A rule the server named (a taken username,
 * a partner who already has a login…) is said in its own words; the rest by the kind of failure.
 * Nothing here ever hides that nothing was changed: a failed request changes nothing.
 */
export function accountFailure(error: unknown): AccountFailure {
  const t = messages.userAccounts.errors;
  if (error instanceof NetworkError || error instanceof NeedsServerError) {
    return { message: t.network, fields: {} };
  }
  if (error instanceof ReadOnlyError) return { message: messages.auth.readOnly, fields: {} };
  if (error instanceof ValidationError) return { message: t.validation_failed, fields: {} };
  if (error instanceof ApiError) {
    const named = error.issues.map(issueText).find((text) => text !== undefined);
    if (named !== undefined) return { message: named, fields: fieldsOf(error.issues) };
    if (error.code === 'forbidden') return { message: t.forbidden, fields: {} };
    if (error.code === 'not_found') return { message: t.not_found, fields: {} };
    if (error.code === 'validation_failed') return { message: t.validation_failed, fields: {} };
    if (error.code === 'conflict') return { message: t.conflict, fields: {} };
  }
  return { message: t.unknown, fields: {} };
}
