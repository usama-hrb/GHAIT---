import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/index.js';
import { StockController } from './stock.controller.js';
import { BatchRepository, ProductStockMoveRepository } from './stock.repositories.js';
import { StockService } from './stock.service.js';

@Module({
  imports: [SyncModule],
  controllers: [StockController],
  providers: [StockService, BatchRepository, ProductStockMoveRepository],
  exports: [StockService],
})
export class StockModule {}
