import { Module } from '@nestjs/common';
import { ReceivablesModule } from '../receivables/index.js';
import { SalesModule } from '../sales/index.js';
import { SyncModule } from '../sync/index.js';
import { CustomersController } from './customers.controller.js';
import { CustomerRepository } from './customers.repositories.js';
import { CustomersService } from './customers.service.js';

@Module({
  imports: [SyncModule, ReceivablesModule, SalesModule],
  controllers: [CustomersController],
  providers: [CustomersService, CustomerRepository],
  exports: [CustomersService],
})
export class CustomersModule {}
