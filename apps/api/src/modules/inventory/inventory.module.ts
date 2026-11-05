import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/index.js';
import { RollRepository, StockMoveRepository } from './inventory.repositories.js';
import { InventoryService } from './inventory.service.js';

@Module({
  imports: [SyncModule],
  providers: [InventoryService, RollRepository, StockMoveRepository],
})
export class InventoryModule {}
