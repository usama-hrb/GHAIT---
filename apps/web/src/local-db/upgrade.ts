import {
  legacyOpPayload,
  legacyRollAsBatch,
  legacySaleLineAsBatchLine,
  type LegacyBatch,
  type Purchase,
  type Roll,
  type StockMove,
} from '@fabric/contracts';
import type { Table, Transaction } from 'dexie';

/** Map.groupBy (ES2024; the project targets ES2023). */
function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

type Synced<R> = R & { serverSeq: number | null };

/** A record without the local `serverSeq`: what an op carries. */
function omitServerSeq<R extends { serverSeq: number | null }>(row: R): Omit<R, 'serverSeq'> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'serverSeq')) as Omit<
    R,
    'serverSeq'
  >;
}

/**
 * Dexie v14 (ADR 0012): this device kept its stock on rolls; from now on it is product batches.
 * Everything is carried over in place, offline, without waiting for the server (which migrated
 * its own rows the same way, tested against each other):
 * - each roll becomes a batch with its id, each stock move a batch move with its id, so the
 *   sale lines, frozen costs and pending ops that point at them stay valid;
 * - sale lines get their batch, unit, quantity and prices; pictures get their product;
 * - ops still waiting to be pushed are rewritten to the shapes the server takes now. An edit of a
 *   fabric or colour can no longer be pushed (the product replaced them): it stays, refused.
 * The rolls and moves themselves stay in their tables as history.
 */
export async function upgradeToBatches(tx: Transaction): Promise<void> {
  const [rolls, moves, purchases] = await Promise.all([
    tx.table<Synced<Roll>, string>('rolls').toArray(),
    tx.table<Synced<StockMove>, string>('stockMoves').toArray(),
    tx.table<Purchase, string>('purchases').toArray(),
  ]);
  const purchaseOf = new Map(purchases.map((purchase) => [purchase.id, purchase]));
  const movesOf = groupBy(moves, (move) => move.rollId);

  const converted = new Map<string, LegacyBatch>();
  const batchRows = [];
  const moveRows = [];
  for (const roll of rolls) {
    const entry = legacyRollAsBatch(
      roll,
      purchaseOf.get(roll.purchaseId),
      movesOf.get(roll.id) ?? [],
    );
    converted.set(roll.id, entry);
    batchRows.push({ ...entry.batch, serverSeq: roll.serverSeq });
    for (const move of entry.moves) {
      moveRows.push({ ...move, serverSeq: entry.serverSeqOf.get(move.id) ?? null });
    }
  }
  await tx.table('productBatches').bulkPut(batchRows);
  await tx.table('productStockMoves').bulkPut(moveRows);

  await tx
    .table<Record<string, unknown>, string>('saleLines')
    .toCollection()
    .modify((line) => {
      const upgraded = legacySaleLineAsBatchLine(line);
      if (upgraded === line) return;
      for (const key of Object.keys(line)) Reflect.deleteProperty(line, key);
      Object.assign(line, upgraded);
    });

  await tx
    .table<Record<string, unknown>, string>('photos')
    .toCollection()
    .modify((photo) => {
      if (photo.productId === undefined || photo.productId === null) {
        photo.productId = photo.variantId ?? null;
      }
    });

  const batchById = new Map(batchRows.map((batch) => [batch.id, batch]));
  const moveById = new Map(moveRows.map((move) => [move.id, move]));
  const outbox = tx.table<Record<string, unknown> & { seq?: number }, number>('outbox');
  for (const entry of await outbox.toArray()) {
    if (entry.seq === undefined || entry.state !== 'pending') continue;
    const entity = entry.entity;
    if (entity === 'roll') {
      const batch = batchById.get(String(entry.entityId));
      const status = (entry.payload as { status?: unknown } | null)?.status;
      if (batch) {
        const record = omitServerSeq(batch);
        await outbox.update(entry.seq, {
          entity: 'product_batch',
          payload: { ...record, status: status ?? record.status },
        });
      }
    } else if (entity === 'stock_move') {
      const move = moveById.get(String(entry.entityId));
      if (move) {
        const record = omitServerSeq(move);
        await outbox.update(entry.seq, { entity: 'product_stock_move', payload: record });
      }
    } else if (entity === 'fabric' || entity === 'variant') {
      await outbox.update(entry.seq, {
        state: 'rejected',
        error: {
          code: 'bad_request',
          message: 'Fabrics and colours were replaced by products; this change was not sent',
        },
      });
    } else {
      await outbox.update(entry.seq, {
        payload: legacyOpPayload(String(entity), entry.payload, (rollId) => converted.get(rollId)),
      });
    }
  }
}

/** Gives every row of `table` the fields it lacks (`undefined`), leaving the rest as they are. */
async function fillMissing(table: Table<Record<string, unknown>, string>, defaults: object) {
  const entries = Object.entries(defaults);
  await table.toCollection().modify((row) => {
    for (const [key, value] of entries) {
      if (row[key] === undefined) row[key] = value;
    }
  });
}

/**
 * Dexie v16 (ADR 0022): partners gained contact details, an expense can pay an employee's salary,
 * and split rules and settlements can name each partner's weight. The rows this device already
 * holds lack those fields; they get the "none" the server gives them (null), in place and offline.
 * No row's meaning changes: a rule or settlement without `partnerWeights` was made when the shop
 * had one partner (splitRulesOf), and an expense without an employee is an ordinary one.
 */
export async function upgradeToPeople(tx: Transaction): Promise<void> {
  await fillMissing(tx.table<Record<string, unknown>, string>('partners'), {
    phone: null,
    title: null,
    startDate: null,
    notes: null,
  });
  await fillMissing(tx.table<Record<string, unknown>, string>('expenses'), {
    employeeId: null,
    salaryMonth: null,
  });
  await fillMissing(tx.table<Record<string, unknown>, string>('profitSplitRules'), {
    partnerWeights: null,
  });
  await fillMissing(tx.table<Record<string, unknown>, string>('settlements'), {
    partnerWeights: null,
  });
}
