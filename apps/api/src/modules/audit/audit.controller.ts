import {
  type AuditListQuery,
  type AuditListResponse,
  auditListQuerySchema,
  auditListResponseSchema,
} from '@fabric/contracts';
import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodQuery, ZodResponse } from '../../common/index.js';
import { AuditService } from './audit.service.js';

/** Read-only: audit_log has no update or delete, here or in the database. */
@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ZodResponse(auditListResponseSchema)
  list(@ZodQuery(auditListQuerySchema) query: AuditListQuery): Promise<AuditListResponse> {
    return this.audit.list(query);
  }
}
