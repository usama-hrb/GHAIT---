import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { ControlDatabaseModule } from '../../database/index.js';
import { KnownHostController } from './known-host.controller.js';
import { ShopHostMiddleware } from './shop-host.middleware.js';
import { ShopLookup } from './shop-lookup.js';
import { ShopSchema } from './shop-schema.js';
import { ShopsRepository } from './shops.repository.js';
import { ShopsService } from './shops.service.js';

/**
 * Chooses the shop of a request by its address (ADR 0029). Imported only when `MULTI_SHOP` is on:
 * it opens the control database, which a one-shop server does not have.
 */
@Module({
  imports: [ControlDatabaseModule],
  controllers: [KnownHostController],
  providers: [ShopsRepository, ShopSchema, ShopLookup, ShopsService],
  exports: [ShopsService],
})
export class ShopsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // `/health` is outside the rule: Docker calls it by the address 127.0.0.1, which is no shop's,
    // and it does no database work. So is Caddy's `ask` route: it comes to the name `api`, and it
    // reads the control database only (known-host.controller.ts).
    consumer
      .apply(ShopHostMiddleware)
      .exclude(
        { path: 'health', method: RequestMethod.ALL },
        { path: 'internal/known-host', method: RequestMethod.GET },
      )
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
