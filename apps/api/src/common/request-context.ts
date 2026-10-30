import { AsyncLocalStorage } from 'node:async_hooks';
import { deviceIdSchema, HEADERS, SERVER_DEVICE_ID } from '@fabric/contracts';
import { BadRequestException, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/** Who and why, for the whole request: read by the audit log and by repositories (device_id). */
export interface RequestContext {
  readonly deviceId: string;
  /** From the x-audit-reason header, percent-decoded. */
  readonly reason: string | null;
  /** Set by the auth guard once the access token is verified. */
  actorId: string | null;
  readonly request: Request;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** The current request's context; undefined outside a request (CLI, startup). */
export function requestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** pino-http sets req.id (generated or taken from x-request-id). */
export function requestIdOf(request: Request): string | undefined {
  const id: unknown = (request as Request & { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}

const MAX_REASON_LENGTH = 500;

function headerValue(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function parseReason(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  let reason: string;
  try {
    reason = decodeURIComponent(raw).trim();
  } catch {
    throw new BadRequestException(`${HEADERS.auditReason} must be percent-encoded UTF-8`);
  }
  if (reason.length > MAX_REASON_LENGTH) {
    throw new BadRequestException(
      `${HEADERS.auditReason} is longer than ${String(MAX_REASON_LENGTH)} characters`,
    );
  }
  return reason === '' ? null : reason;
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: Request, _response: Response, next: NextFunction): void {
    const device = headerValue(request, HEADERS.deviceId);
    if (device !== undefined && !deviceIdSchema.safeParse(device).success) {
      next(new BadRequestException(`${HEADERS.deviceId} must be 1–64 letters, digits, - or _`));
      return;
    }
    let reason: string | null;
    try {
      reason = parseReason(headerValue(request, HEADERS.auditReason));
    } catch (error) {
      next(error);
      return;
    }
    storage.run({ deviceId: device ?? SERVER_DEVICE_ID, reason, actorId: null, request }, next);
  }
}
