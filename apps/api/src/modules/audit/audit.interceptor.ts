import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { TransactionHost } from '../../database/index.js';
import { AuditScope } from './audit.scope.js';

const AUDIT_EXEMPT = Symbol('audit-exempt');
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * For a route that changes nothing worth auditing, or that manages its own transactions
 * (e.g. token rotation, where a rejected token must still revoke its family). Say why.
 */
export const AuditExempt = (why: string): MethodDecorator => SetMetadata(AUDIT_EXEMPT, why);

export class UnauditedMutationError extends Error {
  override readonly name = 'UnauditedMutationError';
}

/**
 * Every mutating request is one unit of work: the handler runs in a transaction, and that
 * transaction commits only if the handler wrote at least one audit entry. A change without its
 * audit entry is rolled back and answered with 500, so it cannot slip in unnoticed.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly tx: TransactionHost,
    private readonly scope: AuditScope,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const exempt = this.reflector.get<string | undefined>(AUDIT_EXEMPT, context.getHandler());
    if (context.getType() !== 'http' || !MUTATING_METHODS.has(request.method) || exempt) {
      return next.handle();
    }
    return from(
      this.tx.run(() =>
        this.scope.run(async (scope) => {
          const result: unknown = await lastValueFrom(next.handle(), { defaultValue: undefined });
          if (scope.count === 0) {
            throw new UnauditedMutationError(
              `${request.method} ${request.originalUrl} wrote no audit entry; rolled back`,
            );
          }
          return result;
        }),
      ),
    );
  }
}
