import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/index.js';
import { CatalogController } from './catalog.controller.js';
import { FabricRepository, SupplierRepository, VariantRepository } from './catalog.repositories.js';
import { CatalogService } from './catalog.service.js';

@Module({
  imports: [SyncModule],
  controllers: [CatalogController],
  providers: [CatalogService, FabricRepository, VariantRepository, SupplierRepository],
  exports: [CatalogService],
})
export class CatalogModule {}
