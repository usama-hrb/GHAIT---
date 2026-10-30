import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/index.js';
import { SyncModule } from '../sync/index.js';
import { DataRepository } from './data.repository.js';
import { DataService } from './data.service.js';

/** `make export` / `make import` (CLIs in src/); no HTTP routes. */
@Module({
  imports: [SyncModule, AuditModule],
  providers: [DataService, DataRepository],
  exports: [DataService],
})
export class DataModule {}
