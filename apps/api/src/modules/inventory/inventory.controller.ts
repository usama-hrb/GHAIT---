import { idSchema, type RollDetail, rollDetailSchema } from '@fabric/contracts';
import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodParam, ZodResponse } from '../../common/index.js';
import { InventoryService } from './inventory.service.js';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('rolls')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  /** The roll, its stock moves and what @fabric/core derives: remaining, cost per metre, costs. */
  @Get(':id')
  @ZodResponse(rollDetailSchema)
  detail(@ZodParam('id', idSchema) id: string): Promise<RollDetail> {
    return this.inventory.detail(id);
  }
}
