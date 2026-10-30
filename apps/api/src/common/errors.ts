import type { ErrorCode, ErrorResponse, ValidationIssue } from '@fabric/contracts';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { requestIdOf } from './request-context.js';
import { issuesOf, ValidationFailedException } from './zod.js';

/** An HTTP error with a specific code, e.g. `invalid_credentials` (401). */
export class AppHttpException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    status: HttpStatus,
  ) {
    super(message, status);
  }
}

const CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'bad_request',
  415: 'bad_request',
  429: 'too_many_requests',
};

/** Postgres SQLSTATE, from a pg error or the driver error drizzle wraps it in. */
export function sqlState(exception: unknown): string | undefined {
  for (let error = exception, depth = 0; error instanceof Error && depth < 3; depth++) {
    const code: unknown = (error as Error & { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    error = error.cause;
  }
  return undefined;
}

/** body-parser errors (malformed JSON, too large) carry an http status of their own. */
function clientErrorStatus(exception: unknown): number | undefined {
  if (!(exception instanceof Error)) return undefined;
  const status: unknown = (exception as Error & { status?: unknown }).status;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
}

/** Maps any thrown value to the one error shape (@fabric/contracts errorResponseSchema). */
export function toErrorResponse(
  exception: unknown,
  requestId?: string,
): { status: number; body: ErrorResponse } {
  const body = (status: number, code: ErrorCode, message: string, issues?: ValidationIssue[]) => ({
    status,
    body: { error: { code, message, requestId, ...(issues ? { issues } : {}) } },
  });

  if (exception instanceof ValidationFailedException) {
    return body(
      400,
      'validation_failed',
      exception.message,
      issuesOf(exception.error, exception.pathPrefix),
    );
  }
  if (exception instanceof AppHttpException) {
    return body(exception.getStatus(), exception.code, exception.message);
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const code = CODE_BY_STATUS[status] ?? (status >= 500 ? 'internal_error' : 'bad_request');
    return body(status, code, status >= 500 ? 'Internal server error' : exception.message);
  }
  const state = sqlState(exception);
  if (state === '23505') return body(409, 'conflict', 'Already exists');
  if (state === '23503') return body(409, 'conflict', 'Refers to a record that does not exist');
  // A CHECK constraint: the same rules as the contracts, so this is a request that skipped them.
  if (state === '23514') return body(400, 'bad_request', 'Violates a data rule');
  const clientStatus = clientErrorStatus(exception);
  if (clientStatus !== undefined) {
    return body(clientStatus, CODE_BY_STATUS[clientStatus] ?? 'bad_request', 'Malformed request');
  }
  return body(500, 'internal_error', 'Internal server error');
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const { status, body } = toErrorResponse(exception, requestIdOf(request));
    if (status >= 500) {
      this.logger.error(
        { err: exception, requestId: body.error.requestId },
        `${request.method} ${request.originalUrl} failed`,
      );
    }
    http.getResponse<Response>().status(status).json(body);
  }
}
