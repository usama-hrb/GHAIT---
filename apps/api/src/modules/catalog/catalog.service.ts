import {
  type FabricFields,
  SERVER_DEVICE_ID,
  type StoredFabric,
  type StoredSupplier,
  type StoredVariant,
  type SupplierInput,
  supplierInputSchema,
  type SyncEntity,
  type VariantInput,
  variantInputSchema,
} from '@fabric/contracts';
import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import { AppHttpException, requestContext } from '../../common/index.js';
import { type SyncedRow, SyncRegistry, SyncService } from '../sync/index.js';
import { FabricRepository, SupplierRepository, VariantRepository } from './catalog.repositories.js';

function stored<R>(row: SyncedRow<R>): R & { serverSeq: number } {
  return { ...row.record, serverSeq: row.serverSeq };
}

/**
 * Fabrics, colours and suppliers (SPEC §2.2, §13). Devices change them through sync; these REST
 * operations go through the same SyncService path, so validation and audit are identical.
 */
@Injectable()
export class CatalogService implements OnModuleInit {
  constructor(
    private readonly registry: SyncRegistry,
    private readonly sync: SyncService,
    private readonly fabrics: FabricRepository,
    private readonly variants: VariantRepository,
    private readonly suppliers: SupplierRepository,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.fabrics);
    this.registry.register(this.variants);
    this.registry.register(this.suppliers);
  }

  async listFabrics(includeVoided: boolean): Promise<StoredFabric[]> {
    return (await this.fabrics.list(includeVoided)).map(stored);
  }

  async getFabric(id: string): Promise<StoredFabric> {
    return stored(this.found('fabric', id, await this.fabrics.find(id)));
  }

  async putFabric(id: string, fields: FabricFields): Promise<StoredFabric> {
    return stored(await this.save('fabric', id, fields)) as StoredFabric;
  }

  async listVariants(fabricId: string, includeVoided: boolean): Promise<StoredVariant[]> {
    this.found('fabric', fabricId, await this.fabrics.find(fabricId));
    return (await this.variants.listByFabric(fabricId, includeVoided)).map(stored);
  }

  async putVariant(id: string, input: VariantInput): Promise<StoredVariant> {
    return stored(await this.save('variant', id, variantInputSchema.parse(input))) as StoredVariant;
  }

  async listSuppliers(includeVoided: boolean): Promise<StoredSupplier[]> {
    return (await this.suppliers.list(includeVoided)).map(stored);
  }

  async getSupplier(id: string): Promise<StoredSupplier> {
    return stored(this.found('supplier', id, await this.suppliers.find(id)));
  }

  async putSupplier(id: string, input: SupplierInput): Promise<StoredSupplier> {
    return stored(
      await this.save('supplier', id, supplierInputSchema.parse(input)),
    ) as StoredSupplier;
  }

  async void(entity: 'fabric' | 'variant' | 'supplier', id: string, reason: string) {
    return stored(await this.sync.voidDirect(entity, id, reason));
  }

  /** Creates or updates through SyncService, keeping createdAt and a void. */
  private async save(entity: SyncEntity, id: string, fields: object) {
    const current = await this.sync.find(entity, id);
    const now = new Date().toISOString();
    return this.sync.saveDirect(entity, {
      ...fields,
      id,
      createdAt: current?.record.createdAt ?? now,
      updatedAt: now,
      deviceId: requestContext()?.deviceId ?? SERVER_DEVICE_ID,
      voidedAt: current?.record.voidedAt ?? null,
    });
  }

  private found<R>(entity: SyncEntity, id: string, row: SyncedRow<R> | undefined): SyncedRow<R> {
    if (!row) throw new AppHttpException('not_found', `No ${entity} ${id}`, HttpStatus.NOT_FOUND);
    return row;
  }
}
