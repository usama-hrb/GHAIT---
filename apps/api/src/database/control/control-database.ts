import { Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import type pg from 'pg';
import { APP_CONFIG, type AppConfig } from '../../config/index.js';
import { CONNECT_TIMEOUT_MS, createPool } from '../client.js';
import { type ControlDb, controlDatabaseUrl, createControlDb } from './connection.js';

/** The control database holds a short list of shops that is read rarely: a few connections do. */
const CONTROL_POOL_MAX = 3;

/** The control database (ADR 0029) with a small pool of its own, apart from every shop's. */
@Injectable()
export class ControlDatabase implements OnApplicationShutdown {
  readonly db: ControlDb;
  private readonly pool: pg.Pool;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pool = createPool(controlDatabaseUrl(config), {
      max: CONTROL_POOL_MAX,
      connectTimeoutMs: CONNECT_TIMEOUT_MS,
    });
    this.db = createControlDb(this.pool);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

/** Imported only where the control database is used, so a one-shop server never opens it. */
@Module({ providers: [ControlDatabase], exports: [ControlDatabase] })
export class ControlDatabaseModule {}
