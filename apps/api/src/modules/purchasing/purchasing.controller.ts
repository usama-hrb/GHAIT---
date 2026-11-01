import {
  idSchema,
  type NewSupplierPayment,
  newSupplierPaymentSchema,
  type PurchaseAggregate,
  purchaseAggregateSchema,
  type PurchaseDetail,
  purchaseDetailSchema,
  type StoredPurchase,
  type StoredSupplierPayment,
  storedPurchaseSchema,
  storedSupplierPaymentSchema,
  type SupplierPayable,
  supplierPayableSchema,
  type SupplierStatementDetail,
  supplierStatementDetailSchema,
  type VoidRequest,
  voidRequestSchema,
} from '@fabric/contracts';
import { Controller, Get, HttpCode, Post } from '@nestjs/common';
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

/** What the shop owes its suppliers (BUILD_PROMPTS 5.3, SP1–SP3). */
@ApiTags('purchasing')
@ApiBearerAuth()
@Controller()
export class SupplierAccountsController {
  constructor(private readonly purchasing: PurchasingService) {}

  @Get('supplier-payables')
  @ZodResponse(z.array(supplierPayableSchema))
  payables(): Promise<SupplierPayable[]> {
    return this.purchasing.payables();
  }

  @Get('suppliers/:id/statement')
  @ZodResponse(supplierStatementDetailSchema)
  statement(@ZodParam('id', idSchema) id: string): Promise<SupplierStatementDetail> {
    return this.purchasing.statement(id);
  }

  /** Pays the supplier part of what is owed; never more than that. */
  @Post('suppliers/:id/payments')
  @HttpCode(200)
  @ZodResponse(supplierStatementDetailSchema)
  pay(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(newSupplierPaymentSchema.omit({ supplierId: true }))
    body: Omit<NewSupplierPayment, 'supplierId'>,
  ): Promise<SupplierStatementDetail> {
    return this.purchasing.pay(id, { ...body, supplierId: id });
  }

  @Post('supplier-payments/:id/void')
  @HttpCode(200)
  @ZodResponse(storedSupplierPaymentSchema)
  voidPayment(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(voidRequestSchema) body: VoidRequest,
  ): Promise<StoredSupplierPayment> {
    return this.purchasing.voidPayment(id, body.reason);
  }
}
