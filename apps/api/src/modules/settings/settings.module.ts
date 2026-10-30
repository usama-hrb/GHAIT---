import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/index.js';
import { SyncModule } from '../sync/index.js';
import { SettingsController } from './settings.controller.js';
import { SettingsRepository } from './settings.repository.js';
import { SettingsService } from './settings.service.js';

@Module({
  imports: [AuditModule, SyncModule],
  controllers: [SettingsController],
  providers: [SettingsService, SettingsRepository],
  exports: [SettingsService],
})
export class SettingsModule {}
