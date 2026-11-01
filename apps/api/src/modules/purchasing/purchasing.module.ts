import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/index.js';
import { SyncModule } from '../sync/index.js';
import { PurchaseRepository } from './purchase.repository.js';
import { PurchasingController, SupplierAccountsController } from './purchasing.controller.js';
import { PurchasingService } from './purchasing.service.js';
import { SupplierPaymentRepository } from './supplier-payment.repository.js';

@Module({
  imports: [SyncModule, InventoryModule],
  controllers: [PurchasingController, SupplierAccountsController],
  providers: [PurchasingService, PurchaseRepository, SupplierPaymentRepository],
})
export class PurchasingModule {}
