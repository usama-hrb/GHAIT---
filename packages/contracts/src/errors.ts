import { z } from 'zod';

/**
 * Machine-readable error codes. Messages are for developers and logs; the web client shows
 * its own (i18n) text for each code.
 */
export const ERROR_CODES = [
  'bad_request',
  'validation_failed',
  'invalid_credentials',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  /** The record is dated inside a settled period: unlock the period first (BUILD_PROMPTS 4.3). */
  'period_locked',
  'too_many_requests',
  'internal_error',
  /**
   * The server cannot serve this request yet and nothing is wrong with the request (503): the shop
   * at this address is being made, or the list of shops cannot be reached (ADR 0029). Try again.
   */
  'service_unavailable',
] as const;
export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const validationIssueSchema = z.object({
  /** Where in the input: ['lines', 0, 'soldCm']. */
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
  code: z.string(),
});
export type ValidationIssue = z.infer<typeof validationIssueSchema>;

/** The one error shape every API error has. */
export const errorResponseSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    /** Same value as the x-request-id response header. */
    requestId: z.string().optional(),
    /** Only for validation_failed. */
    issues: z.array(validationIssueSchema).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
