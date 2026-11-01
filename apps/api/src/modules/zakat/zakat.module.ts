import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/index.js';
import { ZakatController } from './zakat.controller.js';
import { ZakatReportRepository } from './zakat.repositories.js';
import { ZakatService } from './zakat.service.js';

@Module({
  imports: [SyncModule],
  controllers: [ZakatController],
  providers: [ZakatService, ZakatReportRepository],
  exports: [ZakatService],
})
export class ZakatModule {}
