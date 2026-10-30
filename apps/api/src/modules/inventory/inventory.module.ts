import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/index.js';
import { InventoryController } from './inventory.controller.js';
import { RollRepository, StockMoveRepository } from './inventory.repositories.js';
import { InventoryService } from './inventory.service.js';

@Module({
  imports: [SyncModule],
  controllers: [InventoryController],
  providers: [InventoryService, RollRepository, StockMoveRepository],
  exports: [InventoryService],
})
export class InventoryModule {}
