import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/index.js';
import { AuthModule } from '../auth/index.js';
import { AccountsController } from './accounts.controller.js';
import { AccountsRepository } from './accounts.repository.js';
import { AccountsService } from './accounts.service.js';

/** The owner's management of cashier and partner logins (ADR 0024). */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [AccountsController],
  providers: [AccountsService, AccountsRepository],
})
export class AccountsModule {}
