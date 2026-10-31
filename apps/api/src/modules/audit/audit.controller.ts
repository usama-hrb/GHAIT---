import {
  auditActorsSchema,
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

  /** Newest first; filter by entity (and id), account, and days in the shop's time zone. */
  @Get()
  @ZodResponse(auditListResponseSchema)
  list(@ZodQuery(auditListQuerySchema) query: AuditListQuery): Promise<AuditListResponse> {
    return this.audit.list(query);
  }

  /** The accounts that can appear in the log, for its filter. */
  @Get('actors')
  @ZodResponse(auditActorsSchema)
  actors() {
    return this.audit.actors();
  }
}
