import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/index.js';
import { SyncController } from './sync.controller.js';
import { SyncRegistry } from './sync.registry.js';
import { SyncRepository } from './sync.repository.js';
import { SyncService } from './sync.service.js';

/** Modules with synced entities import this and register a SyncHandler on init. */
@Module({
  imports: [AuditModule],
  controllers: [SyncController],
  providers: [SyncRegistry, SyncRepository, SyncService],
  exports: [SyncRegistry, SyncService],
})
export class SyncModule {}
