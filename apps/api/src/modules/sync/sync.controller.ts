import {
  type SyncPullQuery,
  syncPullQuerySchema,
  type SyncPullResponse,
  syncPullResponseSchema,
  type SyncPushRequest,
  syncPushRequestSchema,
  type SyncPushResponse,
  syncPushResponseSchema,
} from '@fabric/contracts';
import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodBody, ZodQuery, ZodResponse } from '../../common/index.js';
import { AuditExempt } from '../audit/index.js';
import { SyncService } from './sync.service.js';

/** The devices' sync hub (ADR 0002): push the outbox, pull what changed. */
@ApiTags('sync')
@ApiBearerAuth()
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('push')
  @AuditExempt(
    'each op runs in its own transaction, with its own audit entry when it changes something',
  )
  @HttpCode(200)
  @ZodResponse(syncPushResponseSchema)
  async push(@ZodBody(syncPushRequestSchema) body: SyncPushRequest): Promise<SyncPushResponse> {
    return { results: await this.sync.push(body.ops) };
  }

  @Get('pull')
  @ZodResponse(syncPullResponseSchema)
  pull(@ZodQuery(syncPullQuerySchema) query: SyncPullQuery): Promise<SyncPullResponse> {
    return this.sync.pull(query);
  }
}
