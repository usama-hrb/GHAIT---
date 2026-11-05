import { describe, expect, it } from 'vitest';
import {
  ApiError,
  NeedsServerError,
  NetworkError,
  ReadOnlyError,
  ValidationError,
} from '@/local-db';
import { saveFailureOf } from './save-failure';

describe('why a setting was not saved', () => {
  it('is “offline” without a connection or a server link', () => {
    expect(saveFailureOf(new NetworkError('x'))).toBe('offline');
    expect(saveFailureOf(new NeedsServerError('x'))).toBe('offline');
  });

  it('is “forbidden” for a read-only account or a role the server refuses', () => {
    expect(saveFailureOf(new ReadOnlyError())).toBe('forbidden');
    expect(saveFailureOf(new ApiError(403, 'forbidden', 'x'))).toBe('forbidden');
    expect(saveFailureOf(new ApiError(401, 'unauthorized', 'x'))).toBe('forbidden');
  });

  it('is “invalid” for a value the contract or the server refuses', () => {
    expect(saveFailureOf(new ValidationError([]))).toBe('invalid');
    expect(saveFailureOf(new ApiError(400, 'validation_failed', 'x'))).toBe('invalid');
    expect(saveFailureOf(new ApiError(413, 'unknown', 'x'))).toBe('invalid');
  });

  it('is “failed” for anything else', () => {
    expect(saveFailureOf(new ApiError(500, 'internal', 'x'))).toBe('failed');
    expect(saveFailureOf(new Error('boom'))).toBe('failed');
    expect(saveFailureOf('boom')).toBe('failed');
  });
});
