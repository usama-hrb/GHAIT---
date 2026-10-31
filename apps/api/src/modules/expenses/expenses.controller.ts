import {
  type ExpenseInput,
  expenseInputSchema,
  idSchema,
  type MonthExpensesSummary,
  monthExpensesSchema,
  type RecurringExpenseInput,
  recurringExpenseInputSchema,
  storedExpenseSchema,
  storedRecurringExpenseSchema,
  type VoidRequest,
  voidRequestSchema,
} from '@fabric/contracts';
import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodBody, ZodParam, ZodQuery, ZodResponse } from '../../common/index.js';
import { ExpensesService } from './expenses.service.js';

const monthQuerySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });
type MonthQuery = z.infer<typeof monthQuerySchema>;
const listQuerySchema = z.object({ includeVoided: z.stringbool().default(false) });
type ListQuery = z.infer<typeof listQuerySchema>;

/** REST access to expenses; the web app reads and writes them offline through sync. */
@ApiTags('expenses')
@ApiBearerAuth()
@Controller()
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  /** Expenses dated or paid in the month. */
  @Get('expenses')
  @ZodResponse(z.array(storedExpenseSchema))
  month(@ZodQuery(monthQuerySchema) query: MonthQuery) {
    return this.expenses.month(query.month);
  }

  /** The month's totals: paid in it (what its settlement deducts, S6), per category, still unpaid. */
  @Get('expenses/summary')
  @ZodResponse(monthExpensesSchema)
  summary(@ZodQuery(monthQuerySchema) query: MonthQuery): Promise<MonthExpensesSummary> {
    return this.expenses.summary(query.month);
  }

  @Get('expenses/:id')
  @ZodResponse(storedExpenseSchema)
  get(@ZodParam('id', idSchema) id: string) {
    return this.expenses.get(id);
  }

  @Put('expenses/:id')
  @ZodResponse(storedExpenseSchema)
  put(@ZodParam('id', idSchema) id: string, @ZodBody(expenseInputSchema) body: ExpenseInput) {
    return this.expenses.put(id, body);
  }

  @Post('expenses/:id/void')
  @HttpCode(200)
  @ZodResponse(storedExpenseSchema)
  void(@ZodParam('id', idSchema) id: string, @ZodBody(voidRequestSchema) body: VoidRequest) {
    return this.expenses.void('expense', id, body.reason);
  }

  @Get('recurring-expenses')
  @ZodResponse(z.array(storedRecurringExpenseSchema))
  listRecurring(@ZodQuery(listQuerySchema) query: ListQuery) {
    return this.expenses.listRecurring(query.includeVoided);
  }

  @Put('recurring-expenses/:id')
  @ZodResponse(storedRecurringExpenseSchema)
  putRecurring(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(recurringExpenseInputSchema) body: RecurringExpenseInput,
  ) {
    return this.expenses.putRecurring(id, body);
  }

  @Post('recurring-expenses/:id/void')
  @HttpCode(200)
  @ZodResponse(storedRecurringExpenseSchema)
  voidRecurring(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(voidRequestSchema) body: VoidRequest,
  ) {
    return this.expenses.void('recurring_expense', id, body.reason);
  }
}
