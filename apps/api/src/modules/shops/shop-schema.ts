import { Injectable, Logger } from '@nestjs/common';
import { bindShop, isMigrated, type ShopRef, TransactionHost } from '../../database/index.js';

/**
 * Whether a shop's database has every migration of this code (ADR 0029 section 7). A shop whose
 * migration failed, or that was never migrated, must not be served by code that expects a schema it
 * does not have. The database is asked, not a flag kept in memory, so a shop comes back by itself
 * once the operator has fixed it and migrated it again.
 */
@Injectable()
export class ShopSchema {
  private readonly logger = new Logger('ShopSchema');

  constructor(private readonly transactions: TransactionHost) {}

  /**
   * False only when the database says that migrations are missing. If it cannot be asked (the
   * database is down), the answer is true: such a shop fails on its own first query anyway, and a
   * fault in this check must not stop every shop.
   */
  async isCurrent(shop: ShopRef): Promise<boolean> {
    try {
      return await bindShop(shop, () => isMigrated(this.transactions.db));
    } catch (error) {
      this.logger.error({ err: error, shop: shop.slug }, 'Could not check the shop for migrations');
      return true;
    }
  }
}
