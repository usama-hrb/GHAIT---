import {
  checkStockMove,
  type Roll,
  type RollDetail,
  type RollHistory,
  rollLedgerOf,
  type StockMove,
  withLockedCosts,
} from '@fabric/contracts';
import type { RollLedger } from '@fabric/core';
import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import { AppHttpException } from '../../common/index.js';
import { type SyncedRow, type SyncHandler, SyncRegistry, SyncRejection } from '../sync/index.js';
import { RollRepository, StockMoveRepository } from './inventory.repositories.js';

const stored = <R>(row: SyncedRow<R>) => ({ ...row.record, serverSeq: row.serverSeq });

/** Rolls and their stock moves (SPEC §2.2, §2.4, §13). Derived values come from @fabric/core. */
@Injectable()
export class InventoryService implements OnModuleInit {
  constructor(
    private readonly registry: SyncRegistry,
    private readonly rolls: RollRepository,
    private readonly moves: StockMoveRepository,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.rolls);
    const moves: SyncHandler<'stock_move'> = {
      entity: 'stock_move',
      find: (id) => this.moves.find(id),
      pull: (since, limit) => this.moves.pull(since, limit),
      append: (move, context) => this.record(move, context),
    };
    this.registry.register(moves);
  }

  /** For a purchase: its rolls and their `purchase` moves, in the caller's transaction. */
  async receive(rolls: readonly Roll[], moves: readonly StockMove[]): Promise<SyncedRow<Roll>[]> {
    const inserted = await this.rolls.insertMany(rolls);
    await this.moves.insertMany(moves);
    return inserted;
  }

  /**
   * Each roll with every move it has so far (for pricing a sale on the server's view), with the
   * costs settlements froze (P9).
   */
  async histories(rollIds: readonly string[]): Promise<Map<string, RollHistory>> {
    const unique = [...new Set(rollIds)];
    const [rolls, rows] = await Promise.all([
      this.rolls.findMany(unique),
      this.moves.listByRolls(unique),
    ]);
    const moves = await this.withLockedCosts(rows.map(stored));
    return new Map(
      rolls.map((roll) => [
        roll.record.id,
        { roll: roll.record, moves: moves.filter((move) => move.rollId === roll.record.id) },
      ]),
    );
  }

  async ledgers(rollIds: readonly string[]): Promise<Map<string, RollLedger>> {
    const histories = await this.histories(rollIds);
    return new Map(
      [...histories].map(([id, history]) => [id, rollLedgerOf(history.roll, history.moves)]),
    );
  }

  /** The moves these records caused (a sale's lines). */
  async movesOf(refIds: readonly string[]): Promise<StockMove[]> {
    return (await this.moves.listByRefs(refIds)).map((row) => row.record);
  }

  /** Moves that come inside another record's op (a sale, a void), in the caller's transaction. */
  async insertMoves(moves: readonly StockMove[]): Promise<void> {
    await this.moves.insertMany(moves);
  }

  rollsOfPurchase(purchaseId: string): Promise<SyncedRow<Roll>[]> {
    return this.rolls.listByPurchase(purchaseId);
  }

  async detail(rollId: string): Promise<RollDetail> {
    const roll = await this.rolls.find(rollId);
    if (!roll) throw new AppHttpException('not_found', `No roll ${rollId}`, HttpStatus.NOT_FOUND);
    const moves = (await this.moves.listByRoll(rollId)).map(stored);
    return {
      roll: stored(roll),
      moves,
      ledger: rollLedgerOf(roll.record, await this.withLockedCosts(moves)),
    };
  }

  private async withLockedCosts<M extends StockMove & { serverSeq: number }>(
    moves: readonly M[],
  ): Promise<M[]> {
    return withLockedCosts(moves, await this.moves.lockedCosts(moves.map((move) => move.id)));
  }

  /** A loss, stocktake count or measurement pushed by a device: re-checked against its roll. */
  private async record(
    move: StockMove,
    context: { entityId: string; deviceId: string },
  ): Promise<SyncedRow<StockMove>> {
    if (move.id !== context.entityId || move.deviceId !== context.deviceId) {
      throw new SyncRejection('bad_request', 'The move does not match the op (id or device)');
    }
    const roll = await this.rolls.find(move.rollId);
    if (!roll) throw new SyncRejection('conflict', 'Refers to a roll the server does not have');
    const history = (await this.moves.listByRoll(move.rollId)).map((row) => row.record);
    const issues = checkStockMove(move, roll.record, history);
    if (issues.length > 0)
      throw new SyncRejection('validation_failed', 'Invalid stock move', issues);
    await this.moves.insertMany([move]);
    const inserted = await this.moves.find(move.id);
    if (!inserted) throw new Error(`stock move ${move.id} not stored`);
    return inserted;
  }
}
