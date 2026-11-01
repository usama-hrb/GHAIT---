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

/** The signed-in account may read the shop but not change it (a partner, BUILD_PROMPTS 4.2). */
export class ReadOnlyError extends Error {
  override readonly name = 'ReadOnlyError';

  constructor() {
    super('This account can read the shop, not change it');
  }
}

/** The account's role may not make this change: a cashier sells, it does not buy (RL3). */
export class NotAllowedError extends Error {
  override readonly name = 'NotAllowedError';

  constructor() {
    super('This account cannot make this change');
  }
}

/** The change is dated inside a settled period (BUILD_PROMPTS 4.3): unlock the period first. */
export function isPeriodLocked(error: unknown): boolean {
  return (
    error instanceof ValidationError &&
    error.issues.some((issue) => issue.message === 'period_locked')
  );
}
