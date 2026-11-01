import {
  type Customer,
  type CustomerInput,
  customerInputSchema,
  customerSchema,
  type Fabric,
  type FabricInput,
  periodDatesOf,
  type Roll,
  rollSchema,
  fabricInputSchema,
  fabricSchema,
  SETTINGS,
  type SettingKey,
  settingInEffect,
  type SettingValue,
  type Supplier,
  type SupplierInput,
  supplierInputSchema,
  supplierSchema,
  type SyncEntity,
  type Variant,
  type VariantInput,
  variantInputSchema,
  variantSchema,
  voidPayloadSchema,
} from '@fabric/contracts';
import type { Table } from 'dexie';
import type { z } from 'zod';
import { matchesSearch } from '@/shared/lib/search';
import type { Local } from './db';
import { parseOrThrow } from './errors';
import type { LocalStore } from './store';

type Base = {
  id: string;
  createdAt: string;
  updatedAt: string;
  deviceId: string;
  voidedAt: string | null;
};

/**
 * Writes for one synced entity: the record and its outbox op in one local transaction
 * (ADR 0002), validated with the same contract schema the server applies.
 */
export class SyncedTable<R extends Base> {
  protected readonly table: Table<Local<R>, string>;

  constructor(
    protected readonly store: LocalStore,
    tableName:
      | 'fabrics'
      | 'variants'
      | 'suppliers'
      | 'rolls'
      | 'customers'
      | 'expenses'
      | 'recurringExpenses'
      | 'partners'
      | 'capitalMoves'
      | 'partnerDraws'
      | 'profitSplitRules'
      | 'cashAdjustments'
      | 'supplierPayments'
      | 'zakatReports'
      | 'photos',
    private readonly entity: SyncEntity,
    private readonly recordSchema: z.ZodType<R>,
  ) {
    this.table = store.db.table<Local<R>, string>(tableName);
  }

  get(id: string): Promise<Local<R> | undefined> {
    return this.table.get(id);
  }

  /** Creates (no id) or updates the record; throws ValidationError for invalid fields. Returns its id. */
  protected async write(fields: object, id: string = crypto.randomUUID()): Promise<string> {
    this.store.assertWritable();
    const { db } = this.store;
    const deviceId = await this.store.deviceId();
    const now = this.store.now().toISOString();
    await db.transaction('rw', [this.table, db.outbox, db.settlements], async () => {
      const existing = await this.table.get(id);
      const record = parseOrThrow(this.recordSchema, {
        ...fields,
        id,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deviceId,
        voidedAt: existing?.voidedAt ?? null,
      });
      await this.store.assertPeriodOpen([
        ...this.periodDates(record),
        ...(existing ? this.periodDates(existing) : []),
      ]);
      await this.table.put({ ...record, serverSeq: existing?.serverSeq ?? null });
      await db.outbox.add({
        opId: crypto.randomUUID(),
        entity: this.entity,
        entityId: id,
        kind: 'upsert',
        payload: record,
        deviceId,
        clientTs: now,
        baseServerSeq: existing?.serverSeq ?? null,
        state: 'pending',
        error: null,
      });
    });
    this.store.changed();
    return id;
  }

  /** No delete (CLAUDE.md): the record stays, voided, with the reason in the op and the audit log. */
  async void(id: string, reason: string): Promise<void> {
    this.store.assertWritable();
    const payload = parseOrThrow(voidPayloadSchema, { reason });
    const { db } = this.store;
    const deviceId = await this.store.deviceId();
    const now = this.store.now().toISOString();
    await db.transaction('rw', [this.table, db.outbox, db.settlements], async () => {
      const existing = await this.table.get(id);
      if (!existing) throw new Error(`No ${this.entity} ${id}`);
      if (existing.voidedAt !== null) return;
      await this.store.assertPeriodOpen(this.periodDates(existing));
      await this.table.put({ ...existing, voidedAt: now, updatedAt: now, deviceId });
      await db.outbox.add({
        opId: crypto.randomUUID(),
        entity: this.entity,
        entityId: id,
        kind: 'void',
        payload,
        deviceId,
        clientTs: now,
        baseServerSeq: existing.serverSeq,
        state: 'pending',
        error: null,
      });
    });
    this.store.changed();
  }

  /** The dates the record is accounted on (periodDatesOf): none for undated entities. */
  private periodDates(record: R): (string | null)[] {
    // A mutable entity's payload is its record (SyncPushPayload).
    return periodDatesOf(this.entity, record as never);
  }
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, 'ar');

export class FabricsRepository extends SyncedTable<Fabric> {
  constructor(store: LocalStore) {
    super(store, 'fabrics', 'fabric', fabricSchema);
  }

  /** Live fabrics (not voided) matching the search, by name. */
  async list(search = ''): Promise<Local<Fabric>[]> {
    const fabrics = await this.table.filter((fabric) => fabric.voidedAt === null).toArray();
    return fabrics
      .filter((fabric) => matchesSearch(search, [fabric.name, fabric.type, ...fabric.tags]))
      .sort(byName);
  }

  async save(input: FabricInput, id?: string): Promise<string> {
    return this.write(parseOrThrow(fabricInputSchema, input), id);
  }
}

export class VariantsRepository extends SyncedTable<Variant> {
  constructor(store: LocalStore) {
    super(store, 'variants', 'variant', variantSchema);
  }

  async listByFabric(fabricId: string): Promise<Local<Variant>[]> {
    const variants = await this.table.where('fabricId').equals(fabricId).toArray();
    return variants
      .filter((variant) => variant.voidedAt === null)
      .sort((a, b) => a.colorName.localeCompare(b.colorName, 'ar'));
  }

  /** Live colours per fabric id. */
  async countByFabric(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    await this.table.each((variant) => {
      if (variant.voidedAt === null)
        counts.set(variant.fabricId, (counts.get(variant.fabricId) ?? 0) + 1);
    });
    return counts;
  }

  async save(input: VariantInput, id?: string): Promise<string> {
    return this.write(parseOrThrow(variantInputSchema, input), id);
  }
}

export class SuppliersRepository extends SyncedTable<Supplier> {
  constructor(store: LocalStore) {
    super(store, 'suppliers', 'supplier', supplierSchema);
  }

  async list(search = ''): Promise<Local<Supplier>[]> {
    const suppliers = await this.table.filter((supplier) => supplier.voidedAt === null).toArray();
    return suppliers
      .filter((supplier) => matchesSearch(search, [supplier.name, supplier.phone, supplier.notes]))
      .sort(byName);
  }

  async save(input: SupplierInput, id?: string): Promise<string> {
    return this.write(parseOrThrow(supplierInputSchema, input), id);
  }
}

export class CustomersRepository extends SyncedTable<Customer> {
  constructor(store: LocalStore) {
    super(store, 'customers', 'customer', customerSchema);
  }

  async list(search = ''): Promise<Local<Customer>[]> {
    const customers = await this.table.filter((customer) => customer.voidedAt === null).toArray();
    return customers
      .filter((customer) => matchesSearch(search, [customer.name, customer.phone, customer.notes]))
      .sort(byName);
  }

  async save(input: CustomerInput, id?: string): Promise<string> {
    return this.write(parseOrThrow(customerInputSchema, input), id);
  }
}

/**
 * Rolls are created with their purchase (PurchasesRepository); afterwards only their remnant
 * mark changes, as an upsert op (the server refuses any other change: checkRollUpdate).
 */
export class RollsTable extends SyncedTable<Roll> {
  constructor(store: LocalStore) {
    super(store, 'rolls', 'roll', rollSchema);
  }

  async setStatus(id: string, status: 'active' | 'remnant'): Promise<void> {
    const roll = await this.get(id);
    if (!roll) throw new Error(`No roll ${id}`);
    if (roll.status === status) return;
    await this.write(
      {
        shortCode: roll.shortCode,
        variantId: roll.variantId,
        purchaseId: roll.purchaseId,
        lengthCmInitial: roll.lengthCmInitial,
        costTotalCents: roll.costTotalCents,
        lengthEstimated: roll.lengthEstimated,
        status,
      },
      id,
    );
  }
}

/** Settings as pulled from the server (changed through the API; offline writes come later). */
export class SettingsRepository {
  constructor(private readonly store: LocalStore) {}

  /** The value in effect on `day` (YYYY-MM-DD), else the default (settingInEffect, as the API). */
  async get<K extends SettingKey>(key: K, day: string): Promise<SettingValue<K>> {
    const rows = await this.store.db.settings.where('key').equals(key).toArray();
    const parsed = SETTINGS[key].schema.safeParse(settingInEffect(key, rows, day)?.value);
    return (parsed.success ? parsed.data : SETTINGS[key].default) as SettingValue<K>;
  }
}
