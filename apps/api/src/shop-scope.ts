import type { INestApplicationContext } from '@nestjs/common';
import type { AppConfig } from './config/index.js';
import { ShopsService } from './modules/shops/index.js';

/** The command was used wrongly (a shop named where there is none, or none where one is needed). */
export class UsageError extends Error {
  override readonly name: string = 'UsageError';
}

/**
 * Checks the `--shop` of a command before anything is opened (ADR 0029, Step 8): a server with one
 * shop takes none, and a server with many shops needs one. A command never picks a shop by
 * itself: with the flag on and no name it would have no database to work on.
 */
export function checkShopArgument(config: AppConfig, shop: string | undefined): void {
  if (!config.multiShop) {
    if (shop !== undefined) {
      throw new UsageError('SHOP is only for MULTI_SHOP=true: this server has one shop.');
    }
    return;
  }
  if (!shop) {
    throw new UsageError(
      'This server has many shops: name one with SHOP=<slug> (make shop-list shows them).',
    );
  }
}

/**
 * Runs the work of a command for the shop it names, as a request for the shop's address would be
 * run (`runAsShop`). With MULTI_SHOP off there is one shop and no name, and the work simply runs.
 * An unknown or closed shop is an error with the shop's name in it.
 */
export async function inShop<T>(
  app: INestApplicationContext,
  config: AppConfig,
  shop: string | undefined,
  work: () => Promise<T>,
): Promise<T> {
  checkShopArgument(config, shop);
  if (!config.multiShop || shop === undefined) return work();
  return app.get(ShopsService).runAsShop(shop, work);
}

/** The exit code of a command that threw: 2 for a wrong use, 1 for anything else. */
export function exitCodeOf(error: unknown): number {
  return error instanceof UsageError ? 2 : 1;
}
