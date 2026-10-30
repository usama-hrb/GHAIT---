import { Module } from '@nestjs/common';
import {
  PaymentAllocationRepository,
  PaymentRepository,
  WriteOffRepository,
} from './receivables.repositories.js';
import { ReceivablesService } from './receivables.service.js';

@Module({
  providers: [
    ReceivablesService,
    PaymentRepository,
    PaymentAllocationRepository,
    WriteOffRepository,
  ],
  exports: [ReceivablesService],
})
export class ReceivablesModule {}
