import {
  type CustomerAccountDetail,
  customerAccountDetailSchema,
  type CustomerInput,
  customerInputSchema,
  type DebtSummary,
  debtSummarySchema,
  idSchema,
  newPaymentSchema,
  newRefundSchema,
  type StoredCustomer,
  storedCustomerSchema,
  type VoidRequest,
  voidRequestSchema,
} from '@fabric/contracts';
import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodBody, ZodParam, ZodQuery, ZodResponse } from '../../common/index.js';
import { CustomersService } from './customers.service.js';

const listQuerySchema = z.object({ includeVoided: z.stringbool().default(false) });
type ListQuery = z.infer<typeof listQuerySchema>;

const paymentBodySchema = newPaymentSchema.omit({ customerId: true });
type PaymentBody = z.input<typeof paymentBodySchema>;
const refundBodySchema = newRefundSchema.omit({ customerId: true });
type RefundBody = z.input<typeof refundBodySchema>;
const writeOffBodySchema = z.object({ saleId: idSchema, reason: voidRequestSchema.shape.reason });
type WriteOffBody = z.infer<typeof writeOffBodySchema>;

/**
 * REST access to customers and their accounts (scripts, tools, the API docs). The web app does
 * the same offline through sync; payments here are applied by the server on its own view.
 */
@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @ZodResponse(z.array(storedCustomerSchema))
  list(@ZodQuery(listQuerySchema) query: ListQuery): Promise<StoredCustomer[]> {
    return this.customers.list(query.includeVoided);
  }

  /** Who owes what (SPEC §4.1): customers with something to collect, the oldest debt first. */
  @Get('debts')
  @ZodResponse(z.array(debtSummarySchema))
  debts(): Promise<DebtSummary[]> {
    return this.customers.debts();
  }

  @Get(':id')
  @ZodResponse(storedCustomerSchema)
  get(@ZodParam('id', idSchema) id: string): Promise<StoredCustomer> {
    return this.customers.get(id);
  }

  @Get(':id/account')
  @ZodResponse(customerAccountDetailSchema)
  account(@ZodParam('id', idSchema) id: string): Promise<CustomerAccountDetail> {
    return this.customers.account(id);
  }

  @Put(':id')
  @ZodResponse(storedCustomerSchema)
  put(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(customerInputSchema) body: CustomerInput,
  ): Promise<StoredCustomer> {
    return this.customers.put(id, body);
  }

  @Post(':id/void')
  @HttpCode(200)
  @ZodResponse(storedCustomerSchema)
  void(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(voidRequestSchema) body: VoidRequest,
  ): Promise<StoredCustomer> {
    return this.customers.void(id, body.reason);
  }

  /** A payment: to `targetSaleId` first, else the oldest unpaid invoices; the rest is credit. */
  @Post(':id/payments')
  @ZodResponse(customerAccountDetailSchema, 201)
  pay(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(paymentBodySchema) body: PaymentBody,
  ): Promise<CustomerAccountDetail> {
    return this.customers.pay(newPaymentSchema.parse({ ...body, customerId: id }));
  }

  /** Money given back out of the customer's credit. */
  @Post(':id/refunds')
  @ZodResponse(customerAccountDetailSchema, 201)
  refund(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(refundBodySchema) body: RefundBody,
  ): Promise<CustomerAccountDetail> {
    return this.customers.refund(newRefundSchema.parse({ ...body, customerId: id }));
  }

  /** Applies the customer's credit to their unpaid invoices, oldest first. */
  @Post(':id/apply-credit')
  @HttpCode(200)
  @ZodResponse(customerAccountDetailSchema)
  applyCredit(@ZodParam('id', idSchema) id: string): Promise<CustomerAccountDetail> {
    return this.customers.applyCredit(id);
  }

  /** Writes off what is due on one of the customer's sales as a bad debt (a loss, S5). */
  @Post(':id/write-offs')
  @ZodResponse(customerAccountDetailSchema, 201)
  writeOff(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(writeOffBodySchema) body: WriteOffBody,
  ): Promise<CustomerAccountDetail> {
    return this.customers.writeOff(id, body.saleId, body.reason);
  }
}
