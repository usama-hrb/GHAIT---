import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

/** Counts the audit entries written during one mutating request (AuditInterceptor). */
@Injectable()
export class AuditScope {
  private readonly storage = new AsyncLocalStorage<{ count: number }>();

  run<T>(work: (scope: { readonly count: number }) => Promise<T>): Promise<T> {
    const scope = { count: 0 };
    return this.storage.run(scope, () => work(scope));
  }

  recorded(): void {
    const scope = this.storage.getStore();
    if (scope) scope.count += 1;
  }
}
