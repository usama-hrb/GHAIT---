import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/index.js';
import { SyncModule } from '../sync/index.js';
import { PurchaseRepository } from './purchase.repository.js';
import { PurchasingController } from './purchasing.controller.js';
import { PurchasingService } from './purchasing.service.js';

@Module({
  imports: [SyncModule, InventoryModule],
  controllers: [PurchasingController],
  providers: [PurchasingService, PurchaseRepository],
})
export class PurchasingModule {}
