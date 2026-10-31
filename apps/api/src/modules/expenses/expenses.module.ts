import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/index.js';
import { ExpensesController } from './expenses.controller.js';
import { ExpenseRepository, RecurringExpenseRepository } from './expenses.repositories.js';
import { ExpensesService } from './expenses.service.js';

@Module({
  imports: [SyncModule],
  controllers: [ExpensesController],
  providers: [ExpensesService, ExpenseRepository, RecurringExpenseRepository],
  exports: [ExpensesService],
})
export class ExpensesModule {}
