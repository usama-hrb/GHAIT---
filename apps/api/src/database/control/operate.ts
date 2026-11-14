import { sql } from 'drizzle-orm';
import type { AppConfig } from '../../config/index.js';
import { createPool } from '../client.js';
import { type ControlDb, controlDatabaseUrl, createControlDb } from './connection.js';

/** What a transaction of the control database is, as `ControlDb.transaction` gives it to its work. */
export type ControlTx = Parameters<Parameters<ControlDb['transaction']>[0]>[0];

/**
 * Key of the lock every operator command takes in the control database (ASCII "oper"), for the
 * length of its transaction. Two commands then cannot interleave: two `shop-new` for one name, an
 * adoption and a new shop for one address, a suspend and a close of one shop. The unique indexes
 * would still refuse a duplicate; the lock gives the refusal in words and keeps each decision
 * made on what is really there.
 */
export const OPERATOR_LOCK = 0x6f_70_65_72;

/**
 * Runs `work` in one transaction of the control database, after taking the operator lock. The
 * transaction commits if `work` returns and is undone if it throws. It uses a pool of its own and
 * closes it, because a command is a short process and not the API.
 */
export async function inControlTransaction<T>(
  config: AppConfig,
  work: (tx: ControlTx) => Promise<T>,
): Promise<T> {
  const pool = createPool(controlDatabaseUrl(config), { max: 1 });
  try {
    return await createControlDb(pool).transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${OPERATOR_LOCK})`);
      return work(tx);
    });
  } finally {
    await pool.end();
  }
}
