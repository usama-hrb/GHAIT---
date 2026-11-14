import { AsyncLocalStorage } from 'node:async_hooks';

/** The shop a piece of work belongs to (ADR 0029). */
export interface ShopRef {
  /** The shop's immutable id: what a token and a device remember. */
  readonly id: string;
  /** The short name the operator types. */
  readonly slug: string;
  /** The PostgreSQL database that holds the shop's data. */
  readonly databaseName: string;
}

const binding = new AsyncLocalStorage<ShopRef>();

/**
 * The shop the running work is bound to. In multi-shop mode every request and every command is
 * bound to exactly one shop before it touches a database; outside that it is undefined. A server
 * with one shop (`MULTI_SHOP` off) never binds one.
 */
export function currentShop(): ShopRef | undefined {
  return binding.getStore();
}

/**
 * Runs `work` for `shop`: everything it awaits reads and writes that shop's database. The binding
 * is made once and cannot nest. `TransactionHost.run` joins a transaction that is already open, so
 * a second shop entered from inside the first would silently use the first shop's database; this
 * refuses it instead. That is the guard behind the isolation of ADR 0029: the API holds the login
 * of every shop's database, so a wrong binding is the one way shop data could cross.
 */
export function bindShop<T>(shop: ShopRef, work: () => T): T {
  const open = binding.getStore();
  if (open) {
    throw new Error(
      `Cannot work for shop "${shop.slug}" inside the work of shop "${open.slug}": a shop is entered once`,
    );
  }
  return binding.run(shop, work);
}
