import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { ControlDatabase, controlSchema } from '../../database/index.js';

export interface ShopRecord {
  readonly id: string;
  readonly slug: string;
  readonly dbName: string;
  readonly state: controlSchema.ShopState;
}

/** Reads of the control database (ADR 0029). Data access only: what a state means is the lookup's. */
@Injectable()
export class ShopsRepository {
  constructor(private readonly control: ControlDatabase) {}

  /** The shop that owns `host` now. An address that was released answers for no shop. */
  async findByHost(host: string): Promise<ShopRecord | undefined> {
    const [row] = await this.control.db
      .select({
        id: controlSchema.shop.id,
        slug: controlSchema.shop.slug,
        dbName: controlSchema.shop.dbName,
        state: controlSchema.shop.state,
      })
      .from(controlSchema.shopHost)
      .innerJoin(controlSchema.shop, eq(controlSchema.shop.id, controlSchema.shopHost.shopId))
      .where(and(eq(controlSchema.shopHost.host, host), isNull(controlSchema.shopHost.releasedAt)))
      .limit(1);
    return row;
  }

  async findBySlug(slug: string): Promise<ShopRecord | undefined> {
    const [row] = await this.control.db
      .select({
        id: controlSchema.shop.id,
        slug: controlSchema.shop.slug,
        dbName: controlSchema.shop.dbName,
        state: controlSchema.shop.state,
      })
      .from(controlSchema.shop)
      .where(eq(controlSchema.shop.slug, slug))
      .limit(1);
    return row;
  }
}
