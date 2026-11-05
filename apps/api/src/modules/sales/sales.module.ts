import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/index.js';
import { AuthModule } from '../auth/index.js';
import { CatalogModule } from '../catalog/index.js';
import { ReceivablesModule } from '../receivables/index.js';
import { StockModule } from '../stock/index.js';
import { SyncModule } from '../sync/index.js';
import { SalesController } from './sales.controller.js';
import {
  SaleLineRepository,
  SaleRepository,
  SaleReturnRepository,
  SaleVoidRepository,
} from './sales.repositories.js';
import { SalesService } from './sales.service.js';

@Module({
  imports: [SyncModule, AuditModule, AuthModule, CatalogModule, StockModule, ReceivablesModule],
  controllers: [SalesController],
  providers: [
    SalesService,
    SaleRepository,
    SaleLineRepository,
    SaleVoidRepository,
    SaleReturnRepository,
  ],
  exports: [SalesService],
})
export class SalesModule {}
