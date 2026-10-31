import {
  idSchema,
  integrityReportSchema,
  type NewCashCountInput,
  newCashCountSchema,
  storedCashAdjustmentSchema,
  type VoidRequest,
  voidRequestSchema,
} from '@fabric/contracts';
import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodBody, ZodParam, ZodResponse } from '../../common/index.js';
import { IntegrityService } from './integrity.service.js';

/** The integrity check and cash counts (BUILD_PROMPTS 4.4); devices do both offline too. */
@ApiTags('integrity')
@ApiBearerAuth()
@Controller()
export class IntegrityController {
  constructor(private readonly integrity: IntegrityService) {}

  /** SPEC §9: what the shop holds against whose it is, to the cent, on every device's records. */
  @Get('integrity')
  @ZodResponse(integrityReportSchema)
  report() {
    return this.integrity.report();
  }

  /** Every count, newest first (voided ones included). */
  @Get('cash-counts')
  @ZodResponse(z.array(storedCashAdjustmentSchema))
  counts() {
    return this.integrity.listCounts();
  }

  /** The money counted on a date, against the books; its difference needs a reason. */
  @Put('cash-counts/:id')
  @ZodResponse(storedCashAdjustmentSchema)
  count(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(newCashCountSchema) body: NewCashCountInput,
  ) {
    return this.integrity.recordCount(id, body);
  }

  @Post('cash-counts/:id/void')
  @HttpCode(200)
  @ZodResponse(storedCashAdjustmentSchema)
  voidCount(@ZodParam('id', idSchema) id: string, @ZodBody(voidRequestSchema) body: VoidRequest) {
    return this.integrity.voidCount(id, body.reason);
  }
}
