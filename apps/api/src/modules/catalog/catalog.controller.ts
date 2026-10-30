import {
  type FabricFields,
  fabricInputSchema,
  idSchema,
  type StoredFabric,
  storedFabricSchema,
  type StoredSupplier,
  storedSupplierSchema,
  type StoredVariant,
  storedVariantSchema,
  type SupplierInput,
  supplierInputSchema,
  type VariantInput,
  variantInputSchema,
  type VoidRequest,
  voidRequestSchema,
} from '@fabric/contracts';
import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodBody, ZodParam, ZodQuery, ZodResponse } from '../../common/index.js';
import { CatalogService } from './catalog.service.js';

const listQuerySchema = z.object({ includeVoided: z.stringbool().default(false) });
type ListQuery = z.infer<typeof listQuerySchema>;

/**
 * REST access to the catalog (scripts, tools, the API docs). The web app reads and writes it
 * offline through sync instead. There is no delete: POST …/void with a reason.
 */
@ApiTags('catalog')
@ApiBearerAuth()
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('fabrics')
  @ZodResponse(z.array(storedFabricSchema))
  listFabrics(@ZodQuery(listQuerySchema) query: ListQuery): Promise<StoredFabric[]> {
    return this.catalog.listFabrics(query.includeVoided);
  }

  @Get('fabrics/:id')
  @ZodResponse(storedFabricSchema)
  getFabric(@ZodParam('id', idSchema) id: string): Promise<StoredFabric> {
    return this.catalog.getFabric(id);
  }

  /** Creates the fabric with this (client-generated) id, or updates it. */
  @Put('fabrics/:id')
  @ZodResponse(storedFabricSchema)
  putFabric(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(fabricInputSchema) body: FabricFields,
  ): Promise<StoredFabric> {
    return this.catalog.putFabric(id, body);
  }

  @Post('fabrics/:id/void')
  @HttpCode(200)
  @ZodResponse(storedFabricSchema)
  voidFabric(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(voidRequestSchema) body: VoidRequest,
  ): Promise<StoredFabric> {
    return this.catalog.void('fabric', id, body.reason) as Promise<StoredFabric>;
  }

  @Get('fabrics/:id/variants')
  @ZodResponse(z.array(storedVariantSchema))
  listVariants(
    @ZodParam('id', idSchema) id: string,
    @ZodQuery(listQuerySchema) query: ListQuery,
  ): Promise<StoredVariant[]> {
    return this.catalog.listVariants(id, query.includeVoided);
  }

  @Put('variants/:id')
  @ZodResponse(storedVariantSchema)
  putVariant(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(variantInputSchema) body: VariantInput,
  ): Promise<StoredVariant> {
    return this.catalog.putVariant(id, body);
  }

  @Post('variants/:id/void')
  @HttpCode(200)
  @ZodResponse(storedVariantSchema)
  voidVariant(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(voidRequestSchema) body: VoidRequest,
  ): Promise<StoredVariant> {
    return this.catalog.void('variant', id, body.reason) as Promise<StoredVariant>;
  }

  @Get('suppliers')
  @ZodResponse(z.array(storedSupplierSchema))
  listSuppliers(@ZodQuery(listQuerySchema) query: ListQuery): Promise<StoredSupplier[]> {
    return this.catalog.listSuppliers(query.includeVoided);
  }

  @Get('suppliers/:id')
  @ZodResponse(storedSupplierSchema)
  getSupplier(@ZodParam('id', idSchema) id: string): Promise<StoredSupplier> {
    return this.catalog.getSupplier(id);
  }

  @Put('suppliers/:id')
  @ZodResponse(storedSupplierSchema)
  putSupplier(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(supplierInputSchema) body: SupplierInput,
  ): Promise<StoredSupplier> {
    return this.catalog.putSupplier(id, body);
  }

  @Post('suppliers/:id/void')
  @HttpCode(200)
  @ZodResponse(storedSupplierSchema)
  voidSupplier(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(voidRequestSchema) body: VoidRequest,
  ): Promise<StoredSupplier> {
    return this.catalog.void('supplier', id, body.reason) as Promise<StoredSupplier>;
  }
}
