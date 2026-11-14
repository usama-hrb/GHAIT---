import { Global, Module } from '@nestjs/common';
import { ShopPools } from './shop-pools.js';
import { TransactionHost } from './transaction.js';

@Global()
@Module({
  providers: [ShopPools, TransactionHost],
  exports: [ShopPools, TransactionHost],
})
export class DatabaseModule {}
