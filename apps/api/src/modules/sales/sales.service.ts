import {
  buildSaleVoid,
  checkSaleAggregate,
  checkSaleVoid,
  type Sale,
  type SaleAggregate,
  type SaleDetail,
  saleFigures,
  type SaleRecords,
  type SaleVoid,
  type SaleVoidAggregate,
  SERVER_DEVICE_ID,
  shopDate,
  type StoredSale,
} from '@fabric/contracts';
import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import { AppHttpException, requestContext } from '../../common/index.js';
import { AuditService } from '../audit/index.js';

import { InventoryService } from '../inventory/index.js';
import { ReceivablesService } from '../receivables/index.js';
import {
  type SyncedRow,
  type SyncHandler,
  SyncRegistry,
  SyncRejection,
  SyncService,
} from '../sync/index.js';
import { SaleLineRepository, SaleRepository, SaleVoidRepository } from './sales.repositories.js';

const stored = <R>(row: SyncedRow<R>) => ({ ...row.record, serverSeq: row.serverSeq });

/**
 * Sales at the counter (SPEC §3, §4). A device sends one append op with the sale, its lines and
 * stock moves and the cash paid there; this prices it again on the server's view of the rolls
 * (checkSaleAggregate) and stores it atomically. A void is its own op (sale_void).
 */
@Injectable()
export class SalesService implements OnModuleInit {
  constructor(
    private readonly registry: SyncRegistry,
    private readonly sync: SyncService,
    private readonly audit: AuditService,
    private readonly sales: SaleRepository,
    private readonly lines: SaleLineRepository,
    private readonly voids: SaleVoidRepository,
    private readonly inventory: InventoryService,
    private readonly receivables: ReceivablesService,
  ) {}

  onModuleInit(): void {
    const sales: SyncHandler<'sale'> = {
      entity: 'sale',
      find: (id) => this.sales.find(id),
      pull: (since, limit) => this.sales.pull(since, limit),
      append: (aggregate, context) => this.receive(aggregate, context),
    };
    const lines: SyncHandler<'sale_line'> = {
      entity: 'sale_line',
      find: (id) => this.lines.find(id),
      pull: (since, limit) => this.lines.pull(since, limit),
    };
    const voids: SyncHandler<'sale_void'> = {
      entity: 'sale_void',
      find: (id) => this.voids.find(id),
      pull: (since, limit) => this.voids.pull(since, limit),
      append: (aggregate, context) => this.receiveVoid(aggregate, context),
    };
    this.registry.register(sales);
    this.registry.register(lines);
    this.registry.register(voids);
  }

  /** REST: the same aggregate a device would push. */
  async create(aggregate: SaleAggregate): Promise<SaleDetail> {
    await this.sync.appendDirect('sale', aggregate.sale.id, aggregate);
    return this.get(aggregate.sale.id);
  }

  /** REST: voids a sale with a reason; the server builds the reversals and the refund. */
  async void(saleId: string, reason: string): Promise<SaleDetail> {
    const records = await this.records(saleId);
    if (!records)
      throw new AppHttpException('not_found', `No sale ${saleId}`, HttpStatus.NOT_FOUND);
    const at = new Date();
    const now = at.toISOString();
    const aggregate = buildSaleVoid(
      { reason, date: shopDate(at) },
      records,
      {
        voidId: crypto.randomUUID(),
        reversalIds: records.moves.map(() => crypto.randomUUID()),
        refundId: crypto.randomUUID(),
      },
      { deviceId: requestContext()?.deviceId ?? SERVER_DEVICE_ID, now },
    );
    await this.sync.appendDirect('sale_void', aggregate.saleVoid.id, aggregate);
    return this.get(saleId);
  }

  /** A customer's sales, voided ones included (their account, BUILD_PROMPTS 3.5). */
  async salesOfCustomer(customerId: string): Promise<Sale[]> {
    return (await this.sales.listByCustomer(customerId)).map((row) => row.record);
  }

  async salesByIds(ids: readonly string[]): Promise<Map<string, Sale>> {
    const rows = await this.sales.findMany(ids);
    return new Map(rows.map((row) => [row.record.id, row.record]));
  }

  async findSale(id: string): Promise<Sale | undefined> {
    return (await this.sales.find(id))?.record;
  }

  async list(limit = 100): Promise<StoredSale[]> {
    return (await this.sales.list(limit)).map(stored);
  }

  async get(id: string): Promise<SaleDetail> {
    const sale = await this.sales.find(id);
    if (!sale) throw new AppHttpException('not_found', `No sale ${id}`, HttpStatus.NOT_FOUND);
    const lines = await this.lines.listBySale(id);
    const [moves, allocations, saleVoid, ledgers, writeOffs] = await Promise.all([
      this.inventory.movesOf(lines.map((line) => line.record.id)),
      this.receivables.allocationsOfSale(id),
      this.voids.findBySale(id),
      this.inventory.ledgers(lines.map((line) => line.record.rollId)),
      this.receivables.writeOffsOfSales([id]),
    ]);
    const [writeOff] = writeOffs;
    return {
      sale: stored(sale),
      lines: lines.map(stored),
      allocations: allocations.map(stored),
      saleVoid: saleVoid ? stored(saleVoid) : null,
      writeOff: writeOff ? stored(writeOff) : null,
      figures: saleFigures(
        sale.record,
        lines.map((line) => line.record),
        moves.filter((move) => move.type === 'sale'),
        ledgers,
        allocations.map(stored),
      ),
    };
  }

  private async records(saleId: string): Promise<SaleRecords | undefined> {
    const sale = await this.sales.find(saleId);
    if (!sale) return undefined;
    const lines = await this.lines.listBySale(saleId);
    const [moves, allocations] = await Promise.all([
      this.inventory.movesOf(lines.map((line) => line.record.id)),
      this.receivables.allocationsOfSale(saleId),
    ]);
    return {
      sale: sale.record,
      moves: moves.filter((move) => move.type === 'sale'),
      allocations: allocations.map((allocation) => allocation.record),
    };
  }

  private async receive(
    aggregate: SaleAggregate,
    context: { entityId: string; deviceId: string },
  ): Promise<SyncedRow<Sale>> {
    const { sale } = aggregate;
    if (sale.id !== context.entityId || sale.deviceId !== context.deviceId) {
      throw new SyncRejection('bad_request', 'The sale does not match the op (id or device)');
    }
    const histories = await this.inventory.histories(aggregate.lines.map((line) => line.rollId));
    const issues = checkSaleAggregate(aggregate, histories);
    if (issues.length > 0) {
      throw new SyncRejection('validation_failed', 'The sale does not match its rolls', issues);
    }
    const written = await this.sales.insert(sale);
    await this.lines.insertMany(aggregate.lines);
    await this.inventory.insertMoves(aggregate.moves);
    if (aggregate.payment) {
      await this.receivables.record(
        aggregate.payment,
        aggregate.allocation ? [aggregate.allocation] : [],
      );
    }
    return written;
  }

  private async receiveVoid(
    aggregate: SaleVoidAggregate,
    context: { entityId: string; deviceId: string },
  ): Promise<SyncedRow<SaleVoid>> {
    const { saleVoid } = aggregate;
    if (saleVoid.id !== context.entityId || saleVoid.deviceId !== context.deviceId) {
      throw new SyncRejection('bad_request', 'The void does not match the op (id or device)');
    }
    const records = await this.records(saleVoid.saleId);
    if (!records) throw new SyncRejection('conflict', 'Refers to a sale the server does not have');
    const issues = checkSaleVoid(aggregate, records);
    if (issues.length > 0) {
      throw new SyncRejection('validation_failed', 'The void does not match the sale', issues);
    }
    if (aggregate.refund) await this.receivables.record(aggregate.refund, []);
    const written = await this.voids.insert(saleVoid);
    await this.inventory.insertMoves(aggregate.reversals);
    const voided = await this.sales.markVoided(
      records.sale.id,
      new Date(saleVoid.createdAt),
      saleVoid.deviceId,
    );
    await this.audit.record({
      entity: 'sale',
      entityId: records.sale.id,
      action: 'void',
      before: records.sale,
      after: voided.record,
      reason: saleVoid.reason,
      deviceId: saleVoid.deviceId,
    });
    return written;
  }
}
