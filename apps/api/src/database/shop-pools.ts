import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type pg from 'pg';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { CONNECT_TIMEOUT_MS, createDatabase, createPool, type Database } from './client.js';
import { withDatabase } from './database-url.js';
import { currentShop, type ShopRef } from './shop-binding.js';

interface Entry {
  readonly pool: pg.Pool;
  readonly db: Database;
}

function open(pool: pg.Pool): Entry {
  return { pool, db: createDatabase(pool) };
}

/**
 * The pools of the shops' databases (ADR 0029), and the one place that turns "the shop this work
 * is bound to" into a database.
 *
 * One-shop mode: the single pool of `DATABASE_URL`, made at start as it always was. Multi-shop
 * mode: one pool for each shop, made the first time the shop is used, on the same server with the
 * same login, small, with a connect timeout and an error listener. A pool that is not used holds
 * no connection (idle ones close), so shops nobody is using cost nothing. Work that is bound to no
 * shop gets an error, never a default shop.
 */
@Injectable()
export class ShopPools implements OnApplicationShutdown {
  private readonly single: Entry | null;
  /** By database name, which is what a pool connects to. */
  private readonly shops = new Map<string, Entry>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.single = config.multiShop ? null : open(createPool(config.databaseUrl));
  }

  /** The database of the shop the running work is bound to. */
  current(): Database {
    if (this.single) return this.single.db;
    const shop = currentShop();
    if (!shop) {
      throw new Error(
        'No shop is bound to this work: a request is bound by its address, a command by its SHOP',
      );
    }
    return this.of(shop).db;
  }

  private of(shop: ShopRef): Entry {
    const found = this.shops.get(shop.databaseName);
    if (found) return found;
    const { multiShop } = this.config;
    if (!multiShop) throw new Error('Shop pools exist only when MULTI_SHOP is on');
    const entry = open(
      createPool(withDatabase(this.config.databaseUrl, shop.databaseName), {
        max: multiShop.shopPoolMax,
        connectTimeoutMs: CONNECT_TIMEOUT_MS,
      }),
    );
    this.shops.set(shop.databaseName, entry);
    return entry;
  }

  async onApplicationShutdown(): Promise<void> {
    const entries = [...this.shops.values(), ...(this.single ? [this.single] : [])];
    await Promise.all(entries.map((entry) => entry.pool.end()));
  }
}
