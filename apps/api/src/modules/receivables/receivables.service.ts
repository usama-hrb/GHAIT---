import type { Payment, PaymentAllocation, WriteOff } from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import type { SyncedRow } from '../sync/index.js';
import {
  PaymentAllocationRepository,
  PaymentRepository,
  WriteOffRepository,
} from './receivables.repositories.js';

/**
 * Storage for what customers owe and pay (SPEC §4.1): payments and refunds, how they are applied
 * to sales, and bad-debt write-offs. Append-only. Sales (the counter's payment, a void's refund)
 * and customers (payments, credit, write-offs, with their checks) both write through here.
 */
@Injectable()
export class ReceivablesService {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly allocations: PaymentAllocationRepository,
    private readonly writeOffs: WriteOffRepository,
  ) {}

  /** A payment or refund and how it is applied, in the caller's transaction. */
  async record(payment: Payment, allocations: readonly PaymentAllocation[]): Promise<void> {
    await this.payments.insert(payment);
    await this.allocations.insertMany(allocations);
  }

  async apply(allocations: readonly PaymentAllocation[]): Promise<void> {
    await this.allocations.insertMany(allocations);
  }

  writeOff(writeOff: WriteOff): Promise<SyncedRow<WriteOff>> {
    return this.writeOffs.insert(writeOff);
  }

  findPayment(id: string) {
    return this.payments.find(id);
  }

  findAllocation(id: string) {
    return this.allocations.find(id);
  }

  findWriteOff(id: string) {
    return this.writeOffs.find(id);
  }

  paymentsByIds(ids: readonly string[]) {
    return this.payments.findMany(ids);
  }

  paymentsOfCustomer(customerId: string) {
    return this.payments.listByCustomer(customerId);
  }

  allocationsOfPayments(paymentIds: readonly string[]) {
    return this.allocations.listByPayments(paymentIds);
  }

  allocationsOfSale(saleId: string) {
    return this.allocations.listBySale(saleId);
  }

  writeOffsOfSales(saleIds: readonly string[]) {
    return this.writeOffs.listBySales(saleIds);
  }

  pullPayments(since: number, limit: number) {
    return this.payments.pull(since, limit);
  }

  pullAllocations(since: number, limit: number) {
    return this.allocations.pull(since, limit);
  }

  pullWriteOffs(since: number, limit: number) {
    return this.writeOffs.pull(since, limit);
  }
}
