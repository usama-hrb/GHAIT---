import type { Roll, StockMove } from '@fabric/contracts';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type SyncedRow, SyncRegistry } from '../sync/index.js';
import { RollRepository, StockMoveRepository } from './inventory.repositories.js';

/** Rolls and their stock moves (SPEC §2.2, §13). Screens and corrections: BUILD_PROMPTS 3.3. */
@Injectable()
export class InventoryService implements OnModuleInit {
  constructor(
    private readonly registry: SyncRegistry,
    private readonly rolls: RollRepository,
    private readonly moves: StockMoveRepository,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.rolls);
    this.registry.register(this.moves);
  }

  /** For a purchase: its rolls and their `purchase` moves, in the caller's transaction. */
  async receive(rolls: readonly Roll[], moves: readonly StockMove[]): Promise<SyncedRow<Roll>[]> {
    const inserted = await this.rolls.insertMany(rolls);
    await this.moves.insertMany(moves);
    return inserted;
  }

  rollsOfPurchase(purchaseId: string): Promise<SyncedRow<Roll>[]> {
    return this.rolls.listByPurchase(purchaseId);
  }
}
