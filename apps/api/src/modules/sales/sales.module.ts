import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/index.js';
import { InventoryModule } from '../inventory/index.js';
import { ReceivablesModule } from '../receivables/index.js';
import { SyncModule } from '../sync/index.js';
import { SalesController } from './sales.controller.js';
import { SaleLineRepository, SaleRepository, SaleVoidRepository } from './sales.repositories.js';
import { SalesService } from './sales.service.js';

@Module({
  imports: [SyncModule, AuditModule, InventoryModule, ReceivablesModule],
  controllers: [SalesController],
  providers: [SalesService, SaleRepository, SaleLineRepository, SaleVoidRepository],
  exports: [SalesService],
})
export class SalesModule {}
