import {
  idSchema,
  type NewZakatPayment,
  newZakatPaymentSchema,
  storedZakatReportSchema,
  type VoidRequest,
  voidRequestSchema,
  zakatReportDetailSchema,
} from '@fabric/contracts';
import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { OwnerOnly, ZodBody, ZodParam, ZodResponse } from '../../common/index.js';
import { AuditExempt } from '../audit/index.js';
import { ZakatService } from './zakat.service.js';

/** Zakat reports (BUILD_PROMPTS 5.1); devices compute and save them offline, through sync. */
@ApiTags('zakat')
@ApiBearerAuth()
@Controller('zakat/reports')
export class ZakatController {
  constructor(private readonly zakat: ZakatService) {}

  /** Every report, the latest hawl first (voided ones included). */
  @Get()
  @ZodResponse(z.array(storedZakatReportSchema))
  list() {
    return this.zakat.list();
  }

  /** With what was paid on it, one draw per partner: a partner reads its own through sync (ADR 0024). */
  @OwnerOnly()
  @Get(':id')
  @ZodResponse(zakatReportDetailSchema)
  get(@ZodParam('id', idSchema) id: string) {
    return this.zakat.detail(id);
  }

  /**
   * Pays zakat on it: a draw per partner by ownership (SPEC §10). A payment that names itself and
   * is sent again writes nothing, so the audit rule of a mutating request (an entry or a roll
   * back) cannot apply to the route as a whole: the service opens its transaction and every draw
   * it writes is audited in it (ADR 0028).
   */
  @Post(':id/payments')
  @AuditExempt('idempotent: audits each draw in its own transaction, the first time only')
  @ZodResponse(zakatReportDetailSchema)
  pay(@ZodParam('id', idSchema) id: string, @ZodBody(newZakatPaymentSchema) body: NewZakatPayment) {
    return this.zakat.pay(id, body);
  }

  @Post(':id/void')
  @HttpCode(200)
  @ZodResponse(storedZakatReportSchema)
  void(@ZodParam('id', idSchema) id: string, @ZodBody(voidRequestSchema) body: VoidRequest) {
    return this.zakat.void(id, body.reason);
  }
}
