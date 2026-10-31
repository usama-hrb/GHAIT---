import {
  checkSplitRule,
  checkSplitRuleVoid,
  type LockedCost,
  periodLockIssues,
  type SettlementAggregate,
  settlementFiguresSchema,
  type SettlementRecord,
  type SettlementShare,
  shopDate,
  type SplitRule,
} from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, gt, isNull, max, sql } from 'drizzle-orm';
import { baseOf, baseValues, schema, TransactionHost } from '../../database/index.js';
import {
  type PeriodGuard,
  type SyncedRow,
  type SyncHandler,
  SyncRejection,
} from '../sync/index.js';

type RuleRow = typeof schema.profitSplitRule.$inferSelect;

function ruleOf(row: RuleRow): SyncedRow<SplitRule> {
  return {
    serverSeq: row.serverSeq,
    record: {
      ...baseOf(row),
      effectiveFrom: row.effectiveFrom,
      ownerWeight: row.ownerWeight,
      partnerWeight: row.partnerWeight,
      shopWeight: row.shopWeight,
    },
  };
}

/** Profit split rules (SPEC §8.3): entered, changed or voided only while in the future. */
@Injectable()
export class SplitRuleRepository implements SyncHandler<'profit_split_rule'> {
  readonly entity = 'profit_split_rule' as const;

  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<SplitRule> | undefined> {
    const [row] = await this.tx.db
      .select()
      .from(schema.profitSplitRule)
      .where(eq(schema.profitSplitRule.id, id));
    return row && ruleOf(row);
  }

  async write(record: SplitRule): Promise<SyncedRow<SplitRule>> {
    const current = await this.find(record.id);
    const issues = checkSplitRule(record, current?.record, {
      today: shopDate(new Date()),
      rules: (await this.listAll()).map((row) => row.record),
    });
    if (issues.length > 0)
      throw new SyncRejection('validation_failed', 'Invalid split rule', issues);
    const fields = {
      effectiveFrom: record.effectiveFrom,
      ownerWeight: record.ownerWeight,
      partnerWeight: record.partnerWeight,
      shopWeight: record.shopWeight,
      updatedAt: new Date(record.updatedAt),
      deviceId: record.deviceId,
    };
    const [row] = await this.tx.db
      .insert(schema.profitSplitRule)
      .values({ id: record.id, createdAt: new Date(record.createdAt), ...fields })
      .onConflictDoUpdate({ target: schema.profitSplitRule.id, set: fields })
      .returning();
    if (!row) throw new Error('write returned no row');
    return ruleOf(row);
  }

  async markVoided(id: string, at: Date, deviceId: string): Promise<SyncedRow<SplitRule>> {
    const current = await this.find(id);
    const issues = current ? checkSplitRuleVoid(current.record, shopDate(new Date())) : [];
    if (issues.length > 0) {
      throw new SyncRejection('validation_failed', 'A rule in effect stays', issues);
    }
    const [row] = await this.tx.db
      .update(schema.profitSplitRule)
      .set({ voidedAt: at, updatedAt: at, deviceId })
      .where(eq(schema.profitSplitRule.id, id))
      .returning();
    if (!row) throw new Error(`no split rule ${id}`);
    return ruleOf(row);
  }

  async pull(since: number, limit: number): Promise<SyncedRow<SplitRule>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.profitSplitRule)
      .where(gt(schema.profitSplitRule.serverSeq, since))
      .orderBy(asc(schema.profitSplitRule.serverSeq))
      .limit(limit);
    return rows.map(ruleOf);
  }

  async listAll(): Promise<SyncedRow<SplitRule>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.profitSplitRule)
      .orderBy(asc(schema.profitSplitRule.effectiveFrom));
    return rows.map(ruleOf);
  }
}

type SettlementRow = typeof schema.settlement.$inferSelect;

function settlementOf(row: SettlementRow): SyncedRow<SettlementRecord> {
  const { id, createdAt, updatedAt, deviceId, voidedAt, serverSeq, lockedAt, ...figures } = row;
  return {
    serverSeq,
    record: {
      ...baseOf({ id, createdAt, updatedAt, deviceId, voidedAt }),
      ...figures,
      lockedAt: lockedAt.toISOString(),
    },
  };
}

type ShareRow = typeof schema.settlementShare.$inferSelect;

function shareOf(row: ShareRow): SyncedRow<SettlementShare> {
  return {
    serverSeq: row.serverSeq,
    record: {
      ...baseOf(row),
      settlementId: row.settlementId,
      partnerId: row.partnerId,
      amountCents: row.amountCents,
    },
  };
}

type CostRow = typeof schema.lockedCost.$inferSelect;

function costOf(row: CostRow): SyncedRow<LockedCost> {
  return {
    serverSeq: row.serverSeq,
    record: {
      ...baseOf(row),
      settlementId: row.settlementId,
      stockMoveId: row.stockMoveId,
      costCents: row.costCents,
    },
  };
}

/**
 * Settlements and what each one created (BUILD_PROMPTS 4.3). Written only by approving or
 * unlocking; devices pull them.
 */
@Injectable()
export class SettlementRepository {
  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<SettlementRecord> | undefined> {
    const [row] = await this.tx.db
      .select()
      .from(schema.settlement)
      .where(eq(schema.settlement.id, id));
    return row && settlementOf(row);
  }

  /** Every settlement, the latest period first (unlocked ones included). */
  async listAll(): Promise<SyncedRow<SettlementRecord>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.settlement)
      .orderBy(sql`${schema.settlement.periodEnd} DESC`, sql`${schema.settlement.createdAt} DESC`);
    return rows.map(settlementOf);
  }

  async shares(settlementId: string): Promise<SyncedRow<SettlementShare>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.settlementShare)
      .where(eq(schema.settlementShare.settlementId, settlementId))
      .orderBy(asc(schema.settlementShare.serverSeq));
    return rows.map(shareOf);
  }

  async lockedCostCount(settlementId: string): Promise<number> {
    const [row] = await this.tx.db
      .select({ n: count() })
      .from(schema.lockedCost)
      .where(eq(schema.lockedCost.settlementId, settlementId));
    return row?.n ?? 0;
  }

  /** The settlement, its shares, retained profit and frozen costs, in one transaction. */
  async insert(aggregate: SettlementAggregate): Promise<void> {
    const { settlement, shares, retainedProfit, lockedCosts } = aggregate;
    await this.tx.db.insert(schema.settlement).values({
      ...baseValues(settlement),
      ...settlementFiguresSchema.parse(settlement),
      lockedAt: new Date(settlement.lockedAt),
    });
    if (shares.length > 0) {
      await this.tx.db.insert(schema.settlementShare).values(
        shares.map((share) => ({
          ...baseValues(share),
          settlementId: share.settlementId,
          partnerId: share.partnerId,
          amountCents: share.amountCents,
        })),
      );
    }
    if (retainedProfit.length > 0) {
      await this.tx.db.insert(schema.capitalMove).values(
        retainedProfit.map((move) => ({
          ...baseValues(move),
          partnerId: move.partnerId,
          type: move.type,
          amountCents: move.amountCents,
          date: move.date,
          note: move.note,
          settlementId: move.settlementId,
        })),
      );
    }
    // Chunks: a month can freeze thousands of costs.
    for (let start = 0; start < lockedCosts.length; start += 500) {
      await this.tx.db.insert(schema.lockedCost).values(
        lockedCosts.slice(start, start + 500).map((cost) => ({
          ...baseValues(cost),
          settlementId: cost.settlementId,
          stockMoveId: cost.stockMoveId,
          costCents: cost.costCents,
        })),
      );
    }
  }

  /** Unlocks: voids the settlement and everything it created. */
  async voidWithChildren(id: string, at: Date, deviceId: string): Promise<void> {
    const voided = { voidedAt: at, updatedAt: at, deviceId };
    await this.tx.db.update(schema.settlement).set(voided).where(eq(schema.settlement.id, id));
    await this.tx.db
      .update(schema.settlementShare)
      .set(voided)
      .where(
        and(eq(schema.settlementShare.settlementId, id), isNull(schema.settlementShare.voidedAt)),
      );
    await this.tx.db
      .update(schema.capitalMove)
      .set(voided)
      .where(and(eq(schema.capitalMove.settlementId, id), isNull(schema.capitalMove.voidedAt)));
    await this.tx.db
      .update(schema.lockedCost)
      .set(voided)
      .where(and(eq(schema.lockedCost.settlementId, id), isNull(schema.lockedCost.voidedAt)));
  }

  async pullSettlements(since: number, limit: number): Promise<SyncedRow<SettlementRecord>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.settlement)
      .where(gt(schema.settlement.serverSeq, since))
      .orderBy(asc(schema.settlement.serverSeq))
      .limit(limit);
    return rows.map(settlementOf);
  }

  async pullShares(since: number, limit: number): Promise<SyncedRow<SettlementShare>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.settlementShare)
      .where(gt(schema.settlementShare.serverSeq, since))
      .orderBy(asc(schema.settlementShare.serverSeq))
      .limit(limit);
    return rows.map(shareOf);
  }

  async pullLockedCosts(since: number, limit: number): Promise<SyncedRow<LockedCost>[]> {
    const rows = await this.tx.db
      .select()
      .from(schema.lockedCost)
      .where(gt(schema.lockedCost.serverSeq, since))
      .orderBy(asc(schema.lockedCost.serverSeq))
      .limit(limit);
    return rows.map(costOf);
  }
}

/** pg advisory lock id of the settled periods (shared by dated writes, exclusive to settling). */
const PERIOD_LOCK = sql.raw('4300');

/**
 * The period lock (SPEC §8.3, BUILD_PROMPTS 4.3): a change dated on or before the last settled
 * day is refused. Dated writes hold the lock shared until they commit, approving or unlocking a
 * settlement holds it exclusively, so no write slips into a period while it is being settled.
 */
@Injectable()
export class PeriodLock implements PeriodGuard {
  constructor(private readonly tx: TransactionHost) {}

  async assertOpen(dates: readonly (string | null)[]): Promise<void> {
    await this.tx.db.execute(sql`SELECT pg_advisory_xact_lock_shared(${PERIOD_LOCK})`);
    const through = await this.lockedThrough();
    const issues = periodLockIssues(dates, through);
    if (issues.length > 0) {
      throw new SyncRejection(
        'period_locked',
        `Dated inside the period settled through ${String(through)}`,
        issues,
      );
    }
  }

  /** Held until the transaction ends: approving and unlocking. */
  async exclusive(): Promise<void> {
    await this.tx.db.execute(sql`SELECT pg_advisory_xact_lock(${PERIOD_LOCK})`);
  }

  async lockedThrough(): Promise<string | null> {
    const [row] = await this.tx.db
      .select({ end: max(schema.settlement.periodEnd) })
      .from(schema.settlement)
      .where(isNull(schema.settlement.voidedAt));
    return row?.end ?? null;
  }
}
