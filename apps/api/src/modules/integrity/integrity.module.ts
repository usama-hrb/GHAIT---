import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/index.js';
import { IntegrityController } from './integrity.controller.js';
import { CashAdjustmentRepository } from './integrity.repositories.js';
import { IntegrityService } from './integrity.service.js';

@Module({
  imports: [SyncModule],
  controllers: [IntegrityController],
  providers: [IntegrityService, CashAdjustmentRepository],
  exports: [IntegrityService],
})
export class IntegrityModule {}
