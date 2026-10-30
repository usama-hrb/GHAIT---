import {
  idSchema,
  type SaleAggregate,
  saleAggregateSchema,
  type SaleDetail,
  saleDetailSchema,
  type StoredSale,
  storedSaleSchema,
  type VoidRequest,
  voidRequestSchema,
} from '@fabric/contracts';
import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodBody, ZodParam, ZodResponse } from '../../common/index.js';
import { SalesService } from './sales.service.js';

@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  /**
   * Creates a sale with its lines, moves and payment, built with @fabric/contracts
   * buildSaleAggregate (the web app pushes the same thing through sync). Priced again with core;
   * the response carries the derived figures (costs, profit, what is still due).
   */
  @Post()
  @ZodResponse(saleDetailSchema, 201)
  create(@ZodBody(saleAggregateSchema) body: SaleAggregate): Promise<SaleDetail> {
    return this.sales.create(body);
  }

  @Get()
  @ZodResponse(z.array(storedSaleSchema))
  list(): Promise<StoredSale[]> {
    return this.sales.list();
  }

  @Get(':id')
  @ZodResponse(saleDetailSchema)
  get(@ZodParam('id', idSchema) id: string): Promise<SaleDetail> {
    return this.sales.get(id);
  }

  /** Cancels the sale: its cloth goes back on the rolls and what was paid is refunded. */
  @Post(':id/void')
  @HttpCode(200)
  @ZodResponse(saleDetailSchema)
  void(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(voidRequestSchema) body: VoidRequest,
  ): Promise<SaleDetail> {
    return this.sales.void(id, body.reason);
  }
}
