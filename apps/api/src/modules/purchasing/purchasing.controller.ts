import {
  idSchema,
  type PurchaseAggregate,
  purchaseAggregateSchema,
  type PurchaseDetail,
  purchaseDetailSchema,
  type StoredPurchase,
  storedPurchaseSchema,
} from '@fabric/contracts';
import { Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodBody, ZodParam, ZodResponse } from '../../common/index.js';
import { PurchasingService } from './purchasing.service.js';

@ApiTags('purchasing')
@ApiBearerAuth()
@Controller('purchases')
export class PurchasingController {
  constructor(private readonly purchasing: PurchasingService) {}

  /**
   * Creates a purchase with its rolls and moves, built with @fabric/contracts
   * buildPurchaseAggregate (the web app pushes the same thing through sync). Re-checked with core.
   */
  @Post()
  @ZodResponse(purchaseDetailSchema, 201)
  create(@ZodBody(purchaseAggregateSchema) body: PurchaseAggregate): Promise<PurchaseDetail> {
    return this.purchasing.create(body);
  }

  @Get()
  @ZodResponse(z.array(storedPurchaseSchema))
  list(): Promise<StoredPurchase[]> {
    return this.purchasing.list();
  }

  @Get(':id')
  @ZodResponse(purchaseDetailSchema)
  get(@ZodParam('id', idSchema) id: string): Promise<PurchaseDetail> {
    return this.purchasing.get(id);
  }
}
