import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/index.js';
import { EmployeesController } from './employees.controller.js';
import { EmployeeRepository, EmployeeSalaryRepository } from './employees.repositories.js';
import { EmployeesService } from './employees.service.js';

@Module({
  imports: [SyncModule],
  controllers: [EmployeesController],
  providers: [EmployeesService, EmployeeRepository, EmployeeSalaryRepository],
  exports: [EmployeesService],
})
export class EmployeesModule {}
