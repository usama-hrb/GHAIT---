import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type pg from 'pg';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { createDatabase, createPool } from './client.js';
import { DB, PG_POOL } from './tokens.js';
import { TransactionHost } from './transaction.js';

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createPool(config.databaseUrl),
    },
    { provide: DB, inject: [PG_POOL], useFactory: createDatabase },
    TransactionHost,
  ],
  exports: [DB, TransactionHost],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
