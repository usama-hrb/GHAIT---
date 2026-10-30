import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Database, Executor } from './client.js';
import { DB } from './tokens.js';

/** Key of the advisory lock every write transaction takes (ASCII "fabr"). */
const WRITE_LOCK = 0x66_61_62_72;

/**
 * The unit of work. `run` opens a transaction and makes it current for everything awaited
 * inside; repositories read `db`, so a service never passes a transaction around. A mutating
 * request runs in one transaction with its audit entries (AuditInterceptor).
 *
 * Write transactions run one at a time (advisory lock): a shop's write rate is tiny, and it makes
 * server_seq order equal commit order, so a sync pull can never step past a row that commits
 * later with a smaller server_seq (ADR 0002).
 */
@Injectable()
export class TransactionHost {
  private readonly current = new AsyncLocalStorage<Executor>();

  constructor(@Inject(DB) private readonly root: Database) {}

  /** The open transaction, or the pool outside one. */
  get db(): Executor {
    return this.current.getStore() ?? this.root;
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
    return this.root.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${WRITE_LOCK})`);
      return this.current.run(tx, work);
    });
  }
}
