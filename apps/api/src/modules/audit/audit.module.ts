import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { AuditRepository } from './audit.repository.js';
import { AuditScope } from './audit.scope.js';
import { AuditService } from './audit.service.js';

@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditRepository, AuditScope],
  // AuditScope for AuditInterceptor, which AppModule registers globally (interceptor order).
  exports: [AuditService, AuditScope],
})
export class AuditModule {}
