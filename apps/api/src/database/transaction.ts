import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Executor } from './client.js';
import { ShopPools } from './shop-pools.js';

/** Key of the advisory lock every write transaction takes (ASCII "fabr"). */
const WRITE_LOCK = 0x66_61_62_72;

/**
 * The unit of work. `run` opens a transaction and makes it current for everything awaited
 * inside; repositories read `db`, so a service never passes a transaction around. A mutating
 * request runs in one transaction with its audit entries (AuditInterceptor).
 *
 * Write transactions run one at a time (advisory lock): a shop's write rate is tiny, and it makes
 * server_seq order equal commit order, so a sync pull can never step past a row that commits
 * later with a smaller server_seq (ADR 0002). The lock lives in the shop's own database, so with
 * many shops each one has its own (ADR 0029).
 *
 * The pool is the one of the shop the work is bound to (`ShopPools`); outside a bound shop, in
 * multi-shop mode, `db` and `run` throw. A transaction belongs to one shop: `run` inside one joins
 * it, and `bindShop` refuses to enter a second shop from inside the first, so a join cannot cross.
 */
@Injectable()
export class TransactionHost {
  private readonly current = new AsyncLocalStorage<Executor>();

  constructor(private readonly pools: ShopPools) {}

  /** The open transaction, or the pool of the bound shop outside one. */
  get db(): Executor {
    return this.current.getStore() ?? this.pools.current();
  }

  get inTransaction(): boolean {
    return this.current.getStore() !== undefined;
  }

  /**
   * Runs `work` in a savepoint of the open transaction: if it throws, only its own writes are
   * rolled back and the transaction can go on (one bad sync op must not undo the others).
   */
  savepoint<T>(work: () => Promise<T>): Promise<T> {
    const tx = this.current.getStore();
    if (!tx) throw new Error('savepoint() needs an open transaction (run)');
    return tx.transaction((inner) => this.current.run(inner, work));
  }

  /** Runs `work` in a transaction; inside one already, it joins it. Throwing rolls back. */
  run<T>(work: () => Promise<T>): Promise<T> {
    if (this.inTransaction) return work();
    return this.pools.current().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${WRITE_LOCK})`);
      return this.current.run(tx, work);
    });
  }
}
