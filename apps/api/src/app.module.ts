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
import { CustomersModule } from './modules/customers/index.js';
import { DataModule } from './modules/data/index.js';
import { DevicesModule } from './modules/devices/index.js';
import { ExpensesModule } from './modules/expenses/index.js';
import { HealthModule } from './modules/health/index.js';
import { PartnersModule } from './modules/partners/index.js';
import { IntegrityModule } from './modules/integrity/index.js';
import { InventoryModule } from './modules/inventory/index.js';
import { PurchasingModule } from './modules/purchasing/index.js';
import { ReceivablesModule } from './modules/receivables/index.js';
import { SalesModule } from './modules/sales/index.js';
import { SettingsModule } from './modules/settings/index.js';
import { SettlementsModule } from './modules/settlements/index.js';
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
        ReceivablesModule,
        SalesModule,
        CustomersModule,
        ExpensesModule,
        PartnersModule,
        SettlementsModule,
        IntegrityModule,
        DataModule,
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
