import { Injectable, type OnModuleInit } from '@nestjs/common';
import { SyncRegistry } from '../sync/index.js';
import { RollRepository, StockMoveRepository } from './inventory.repositories.js';

/**
 * The rolls and stock moves the shop kept its stock on before product batches (ADR 0012). They
 * stay as history: devices and exports still receive them, and nothing writes them any more. The
 * stock itself is the stock module's.
 */
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
}
