import { type BatchDetail, batchDetailSchema, idSchema } from '@fabric/contracts';
import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodParam, ZodResponse } from '../../common/index.js';
import { StockService } from './stock.service.js';

@ApiTags('stock')
@ApiBearerAuth()
@Controller('batches')
export class StockController {
  constructor(private readonly stock: StockService) {}

  /** The batch, its moves and what @fabric/core derives: what is left, costs, measurement. */
  @Get(':id')
  @ZodResponse(batchDetailSchema)
  detail(@ZodParam('id', idSchema) id: string): Promise<BatchDetail> {
    return this.stock.detail(id);
  }
}
