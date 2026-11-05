import {
  ApiError,
  NeedsServerError,
  NetworkError,
  ReadOnlyError,
  ValidationError,
} from '@/local-db';

/** Why a setting was not saved, in the terms the screens explain. */
export type SaveFailure = 'offline' | 'forbidden' | 'invalid' | 'failed';

/**
 * Settings are saved on the server (ADR 0017), so a failure is mostly "no connection". Nothing is
 * kept half-saved: the screens say so, and the values on the device stay what they were.
 */
export function saveFailureOf(error: unknown): SaveFailure {
  if (error instanceof NetworkError || error instanceof NeedsServerError) return 'offline';
  if (error instanceof ReadOnlyError) return 'forbidden';
  if (error instanceof ValidationError) return 'invalid';
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return 'forbidden';
    if (error.status === 400 || error.status === 413 || error.status === 422) return 'invalid';
  }
  return 'failed';
}
