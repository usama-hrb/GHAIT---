import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/index.js';
import { SyncModule } from '../sync/index.js';
import { SettlementsController } from './settlements.controller.js';
import {
  PeriodLock,
  SettlementRepository,
  SplitRuleRepository,
} from './settlements.repositories.js';
import { SettlementsService } from './settlements.service.js';

@Module({
  imports: [SyncModule, AuditModule],
  controllers: [SettlementsController],
  providers: [SettlementsService, SettlementRepository, SplitRuleRepository, PeriodLock],
  exports: [SettlementsService],
})
export class SettlementsModule {}
