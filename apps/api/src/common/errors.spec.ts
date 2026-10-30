import { BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppHttpException, toErrorResponse } from './errors.js';
import { ValidationFailedException, ZodValidationPipe } from './zod.js';

describe('toErrorResponse', () => {
  it('maps validation failures with their issues', () => {
    const error = z.object({ soldCm: z.int() }).safeParse({ soldCm: 1.5 }).error;
    if (!error) throw new Error('expected a zod error');
    expect(toErrorResponse(new ValidationFailedException(error, ['lines', 0]), 'r1')).toEqual({
      status: 400,
      body: {
        error: {
          code: 'validation_failed',
          message: 'Invalid input',
          requestId: 'r1',
          issues: [
            {
              path: ['lines', 0, 'soldCm'],
              message: error.issues[0]?.message,
              code: 'invalid_type',
            },
          ],
        },
      },
    });
  });

  it('keeps the code of an AppHttpException', () => {
    expect(
      toErrorResponse(new AppHttpException('invalid_credentials', 'nope', HttpStatus.UNAUTHORIZED)),
    ).toMatchObject({
      status: 401,
      body: { error: { code: 'invalid_credentials', message: 'nope' } },
    });
  });

  it('maps Nest HTTP exceptions by status', () => {
    expect(toErrorResponse(new NotFoundException('gone'))).toMatchObject({
      status: 404,
      body: { error: { code: 'not_found', message: 'gone' } },
    });
    expect(toErrorResponse(new BadRequestException('bad'))).toMatchObject({
      status: 400,
      body: { error: { code: 'bad_request' } },
    });
  });

  it('turns a unique violation (23505), also wrapped, into 409 conflict', () => {
    const pgError = Object.assign(new Error('duplicate key'), { code: '23505' });
    expect(toErrorResponse(pgError).status).toBe(409);
    expect(toErrorResponse(new Error('query failed', { cause: pgError })).status).toBe(409);
  });

  it('never leaks the message of an unexpected error', () => {
    expect(toErrorResponse(new Error('password=hunter2 at db.internal'))).toEqual({
      status: 500,
      body: {
        error: { code: 'internal_error', message: 'Internal server error', requestId: undefined },
      },
    });
    expect(toErrorResponse('a string')).toMatchObject({ status: 500 });
  });

  it('keeps the client status of a body-parser error', () => {
    const parseError = Object.assign(new SyntaxError('Unexpected end'), { status: 400 });
    expect(toErrorResponse(parseError)).toMatchObject({
      status: 400,
      body: { error: { code: 'bad_request', message: 'Malformed request' } },
    });
  });
});

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(z.object({ username: z.string().trim().toLowerCase() }));

  it('returns the parsed (transformed) value', () => {
    expect(pipe.transform({ username: ' Owner ', extra: true })).toEqual({ username: 'owner' });
  });

  it('throws ValidationFailedException on invalid input', () => {
    expect(() => pipe.transform({})).toThrow(ValidationFailedException);
  });
});
