import type { ValidationIssue } from '@fabric/contracts';
import type { z } from 'zod';

/** Input a repository refused; `issues` are the contract's, as the API would report them. */
export class ValidationError extends Error {
  override readonly name = 'ValidationError';
  constructor(readonly issues: ValidationIssue[]) {
    super('Invalid input');
  }
}

export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(
      result.error.issues.map((issue) => ({
        path: issue.path.map((part) => (typeof part === 'symbol' ? String(part) : part)),
        message: issue.message,
        code: issue.code,
      })),
    );
  }
  return result.data;
}
