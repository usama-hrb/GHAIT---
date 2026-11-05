import {
  type Product,
  type ProductFields,
  productInputSchema,
  type StoredProduct,
  type ProductInput,
  SERVER_DEVICE_ID,
  type StoredFabric,
  type StoredSupplier,
  type StoredVariant,
  type SupplierInput,
  supplierInputSchema,
  type SyncEntity,
} from '@fabric/contracts';
import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import { AppHttpException, requestContext } from '../../common/index.js';
import { type SyncedRow, SyncRegistry, SyncService } from '../sync/index.js';
import {
  FabricRepository,
  ProductRepository,
  SupplierRepository,
  VariantRepository,
} from './catalog.repositories.js';

function stored<R>(row: SyncedRow<R>): R & { serverSeq: number } {
  return { ...row.record, serverSeq: row.serverSeq };
}

/**
 * Products and suppliers (SPEC §2.2, §13), with the fabrics and colours they replaced (ADR 0012),
 * which are only read. Devices change the rest through sync; these REST operations go through the
 * same SyncService path, so validation and audit are identical.
 */
@Injectable()
export class CatalogService implements OnModuleInit {
  constructor(
    private readonly registry: SyncRegistry,
    private readonly sync: SyncService,
    private readonly fabrics: FabricRepository,
    private readonly variants: VariantRepository,
    private readonly products: ProductRepository,
    private readonly suppliers: SupplierRepository,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.fabrics);
    this.registry.register(this.variants);
    this.registry.register(this.products);
    this.registry.register(this.suppliers);
  }

  async listFabrics(includeVoided: boolean): Promise<StoredFabric[]> {
    return (await this.fabrics.list(includeVoided)).map(stored);
  }

  async getFabric(id: string): Promise<StoredFabric> {
    return stored(this.found('fabric', id, await this.fabrics.find(id)));
  }

  async listVariants(fabricId: string, includeVoided: boolean): Promise<StoredVariant[]> {
    this.found('fabric', fabricId, await this.fabrics.find(fabricId));
    return (await this.variants.listByFabric(fabricId, includeVoided)).map(stored);
  }

  async listProducts(includeVoided: boolean): Promise<StoredProduct[]> {
    return (await this.products.list(includeVoided)).map(stored);
  }

  /** These products, voided ones included (history keeps reading them). */
  async productsByIds(ids: readonly string[]): Promise<Map<string, Product>> {
    return new Map((await this.products.findMany(ids)).map((row) => [row.record.id, row.record]));
  }

  async getProduct(id: string): Promise<StoredProduct> {
    return stored(this.found('product', id, await this.products.find(id)));
  }

  async putProduct(id: string, input: ProductInput): Promise<StoredProduct> {
    const fields: ProductFields = productInputSchema.parse(input);
    return stored(await this.save('product', id, fields)) as StoredProduct;
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

  async void(entity: 'product' | 'supplier', id: string, reason: string) {
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
