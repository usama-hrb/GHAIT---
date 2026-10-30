/** Injection tokens: `@Inject(DB) db: Database`. Prefer TransactionHost in repositories. */
export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');
