import {
  idSchema,
  type NewSettlement,
  newSettlementSchema,
  settlementDetailSchema,
  settlementPreviewQuerySchema,
  settlementPreviewSchema,
  type SplitRuleInput,
  splitRuleInputSchema,
  storedSettlementSchema,
  storedSplitRuleSchema,
  type VoidRequest,
  voidRequestSchema,
} from '@fabric/contracts';
import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodBody, ZodParam, ZodQuery, ZodResponse } from '../../common/index.js';
import { SettlementsService } from './settlements.service.js';

/**
 * Monthly settlement (BUILD_PROMPTS 4.3). Approving and unlocking happen here, online: they need
 * every device's records. Devices pull the results and preview offline.
 */
@ApiTags('settlements')
@ApiBearerAuth()
@Controller()
export class SettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  /** Every settlement, the latest period first (unlocked ones included). */
  @Get('settlements')
  @ZodResponse(z.array(storedSettlementSchema))
  list() {
    return this.settlements.list();
  }

  /** The period ending on `end`, as approving it now would settle it. */
  @Get('settlements/preview')
  @ZodResponse(settlementPreviewSchema)
  preview(@ZodQuery(settlementPreviewQuerySchema) query: { end: string }) {
    return this.settlements.preview(query.end);
  }

  @Get('settlements/:id')
  @ZodResponse(settlementDetailSchema)
  get(@ZodParam('id', idSchema) id: string) {
    return this.settlements.detail(id);
  }

  /** Approves and locks the period; `expected` is the breakdown the owner saw (409 if it changed). */
  @Post('settlements')
  @ZodResponse(settlementDetailSchema)
  approve(@ZodBody(newSettlementSchema) body: NewSettlement) {
    return this.settlements.approve(body);
  }

  /** Unlocks the latest settled period, with the reason (audited). */
  @Post('settlements/:id/unlock')
  @HttpCode(200)
  @ZodResponse(settlementDetailSchema)
  unlock(@ZodParam('id', idSchema) id: string, @ZodBody(voidRequestSchema) body: VoidRequest) {
    return this.settlements.unlock(id, body.reason);
  }

  @Get('split-rules')
  @ZodResponse(z.array(storedSplitRuleSchema))
  splitRules() {
    return this.settlements.splitRules();
  }

  /** A future rule (SPEC §8.3: never retroactive). */
  @Put('split-rules/:id')
  @ZodResponse(storedSplitRuleSchema)
  putSplitRule(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(splitRuleInputSchema) body: SplitRuleInput,
  ) {
    return this.settlements.putSplitRule(id, body);
  }

  @Post('split-rules/:id/void')
  @HttpCode(200)
  @ZodResponse(storedSplitRuleSchema)
  voidSplitRule(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(voidRequestSchema) body: VoidRequest,
  ) {
    return this.settlements.voidSplitRule(id, body.reason);
  }
}
