import {
  type DynamicModule,
  Module,
  type MiddlewareConsumer,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import {
  AllExceptionsFilter,
  loggingModule,
  RequestContextMiddleware,
  ZodSerializerInterceptor,
} from './common/index.js';
import { type AppConfig, ConfigModule } from './config/index.js';
import { DatabaseModule } from './database/index.js';
import { AuditInterceptor, AuditModule } from './modules/audit/index.js';
import { AuthModule } from './modules/auth/index.js';
import { CatalogModule } from './modules/catalog/index.js';
import { DevicesModule } from './modules/devices/index.js';
import { HealthModule } from './modules/health/index.js';
import { InventoryModule } from './modules/inventory/index.js';
import { PurchasingModule } from './modules/purchasing/index.js';
import { SettingsModule } from './modules/settings/index.js';
import { SyncModule } from './modules/sync/index.js';

@Module({})
export class AppModule implements NestModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        loggingModule(config),
        DatabaseModule,
        AuditModule,
        AuthModule,
        SettingsModule,
        SyncModule,
        CatalogModule,
        DevicesModule,
        InventoryModule,
        PurchasingModule,
        HealthModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        // Order matters: the audit unit of work wraps the response serializer, so a response
        // that fails its schema also rolls the change back.
        { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
