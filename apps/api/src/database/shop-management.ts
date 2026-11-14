import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import type { AppConfig } from '../config/index.js';
import { createDatabase, createPool } from './client.js';
import { controlDatabaseUrl, createControlDb } from './control/connection.js';
import { prepareControlDatabase } from './control/migrate.js';
import { type ControlTx, inControlTransaction } from './control/operate.js';
import * as controlSchema from './control/schema.js';
import { withDatabase } from './database-url.js';
import { isMigrated } from './migrate.js';
import { type IssuedSetupCode, issueSetupCode, requireSetupCodeSecret } from './setup-code.js';
import { checkedHost, checkedSlug, ShopRefused } from './shop-names.js';

/** The longest reason the operator can give: it is kept in the event log, not a place for a document. */
const REASON_MAX = 500;

interface ActorRequest {
  /** Who is doing it: the operator's login on the server. */
  readonly actor: string;
}

function checkedActor(actor: string): string {
  const name = actor.trim();
  if (!name) throw new ShopRefused('Who is doing this? The actor is empty.');
  return name;
}

function checkedReason(reason: string | undefined, what: string): string {
  const text = (reason ?? '').trim();
  if (!text) throw new ShopRefused(`Say why: ${what} needs a reason.`);
  if (text.length > REASON_MAX) throw new ShopRefused(`The reason is longer than ${REASON_MAX}.`);
  return text;
}

async function shopNamed(tx: ControlTx, slug: string) {
  const [row] = await tx.select().from(controlSchema.shop).where(eq(controlSchema.shop.slug, slug));
  if (!row) throw new ShopRefused(`There is no shop "${slug}". make shop-list shows the shops.`);
  return row;
}

async function record(
  tx: ControlTx,
  shopId: string,
  actor: string,
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await tx.insert(controlSchema.shopEvent).values({ shopId, actor, action, detail });
}

export interface StateChange {
  /** `already`: the shop was in that state, and nothing was written. */
  readonly outcome: 'changed' | 'already';
  readonly slug: string;
  readonly state: controlSchema.ShopState;
}

/**
 * `make shop-suspend` (ADR 0029 section 9): the shop answers 403 `shop_suspended` on every route
 * but /health, within 30 seconds (the lookup cache). Its data stays and its tablets go on selling
 * offline. Only a shop that is served can be suspended; one being made is not served at all, and a
 * closed one is over. A reason is required and goes in the event log.
 */
export async function suspendShop(
  config: AppConfig,
  request: ActorRequest & { readonly slug: string; readonly reason: string | undefined },
  now: Date = new Date(),
): Promise<StateChange> {
  const slug = checkedSlug(request.slug);
  const actor = checkedActor(request.actor);
  const reason = checkedReason(request.reason, 'suspending a shop');
  await prepareControlDatabase(config);
  return inControlTransaction(config, async (tx) => {
    const shop = await shopNamed(tx, slug);
    if (shop.state === 'suspended') return { outcome: 'already', slug, state: shop.state };
    if (shop.state !== 'active') {
      throw new ShopRefused(
        shop.state === 'provisioning'
          ? `The shop "${slug}" is being made and is not served: finish make shop-new first.`
          : `The shop "${slug}" is closed for good.`,
      );
    }
    await tx
      .update(controlSchema.shop)
      .set({ state: 'suspended', suspendedAt: now, suspendedReason: reason })
      .where(eq(controlSchema.shop.id, shop.id));
    await record(tx, shop.id, actor, 'shop.suspended', { reason });
    return { outcome: 'changed', slug, state: 'suspended' };
  });
}

/**
 * `make shop-resume`: the reverse of suspending. The shop is served again within 30 seconds. What
 * the suspension did is kept in the event log; the shop's own row is cleared of it.
 */
export async function resumeShop(
  config: AppConfig,
  request: ActorRequest & { readonly slug: string },
): Promise<StateChange> {
  const slug = checkedSlug(request.slug);
  const actor = checkedActor(request.actor);
  await prepareControlDatabase(config);
  return inControlTransaction(config, async (tx) => {
    const shop = await shopNamed(tx, slug);
    if (shop.state === 'active') return { outcome: 'already', slug, state: shop.state };
    if (shop.state !== 'suspended') {
      throw new ShopRefused(
        shop.state === 'provisioning'
          ? `The shop "${slug}" is being made, not suspended: finish make shop-new.`
          : `The shop "${slug}" is closed for good and cannot be resumed.`,
      );
    }
    await tx
      .update(controlSchema.shop)
      .set({ state: 'active', suspendedAt: null, suspendedReason: null })
      .where(eq(controlSchema.shop.id, shop.id));
    await record(tx, shop.id, actor, 'shop.resumed', {
      suspendedAt: shop.suspendedAt?.toISOString() ?? null,
      suspendedReason: shop.suspendedReason,
    });
    return { outcome: 'changed', slug, state: 'active' };
  });
}

/**
 * `make shop-close` (ADR 0029 section 9): the end of a shop. It is final, so the operator must
 * type the name again (`confirm`). The address stops answering at once for new lookups and within
 * 30 seconds for the ones cached; the database and every row stay on the server, and the
 * addresses are not released (so none of them can be given to another shop by mistake). Dropping
 * the database is a separate decision, after an export, and no command does it.
 */
export async function closeShop(
  config: AppConfig,
  request: ActorRequest & {
    readonly slug: string;
    readonly reason: string | undefined;
    readonly confirm: string | undefined;
  },
  now: Date = new Date(),
): Promise<StateChange> {
  const slug = checkedSlug(request.slug);
  const actor = checkedActor(request.actor);
  const reason = checkedReason(request.reason, 'closing a shop');
  if (request.confirm !== slug) {
    throw new ShopRefused(
      `Closing a shop cannot be undone. Type its name again to confirm: CONFIRM=${slug}`,
    );
  }
  await prepareControlDatabase(config);
  return inControlTransaction(config, async (tx) => {
    const shop = await shopNamed(tx, slug);
    if (shop.state === 'closed') return { outcome: 'already', slug, state: shop.state };
    await tx
      .update(controlSchema.shop)
      .set({ state: 'closed', closedAt: now })
      .where(eq(controlSchema.shop.id, shop.id));
    await record(tx, shop.id, actor, 'shop.closed', { reason, from: shop.state });
    return { outcome: 'changed', slug, state: 'closed' };
  });
}

export interface HostAdded {
  readonly outcome: 'added' | 'already';
  readonly slug: string;
  readonly host: string;
}

/**
 * `make shop-host`: one more address for a shop that is served or suspended (a host name for the
 * shop that was adopted by its IP address, a custom domain). The first address of a new shop is
 * `shop-new`'s. An address belongs to one shop while it is in use.
 */
export async function addShopHost(
  config: AppConfig,
  request: ActorRequest & { readonly slug: string; readonly host: string },
  now: Date = new Date(),
): Promise<HostAdded> {
  const slug = checkedSlug(request.slug);
  const host = checkedHost(request.host);
  const actor = checkedActor(request.actor);
  await prepareControlDatabase(config);
  return inControlTransaction(config, async (tx) => {
    const shop = await shopNamed(tx, slug);
    if (shop.state !== 'active' && shop.state !== 'suspended') {
      throw new ShopRefused(
        shop.state === 'provisioning'
          ? `The shop "${slug}" is being made: finish make shop-new first.`
          : `The shop "${slug}" is closed for good.`,
      );
    }
    const [used] = await tx
      .select({ shopId: controlSchema.shopHost.shopId, slug: controlSchema.shop.slug })
      .from(controlSchema.shopHost)
      .innerJoin(controlSchema.shop, eq(controlSchema.shop.id, controlSchema.shopHost.shopId))
      .where(and(eq(controlSchema.shopHost.host, host), isNull(controlSchema.shopHost.releasedAt)));
    if (used && used.shopId !== shop.id) {
      throw new ShopRefused(`The address "${host}" already belongs to the shop "${used.slug}".`);
    }
    if (used) return { outcome: 'already', slug, host };
    await tx.insert(controlSchema.shopHost).values({ host, shopId: shop.id, createdAt: now });
    await record(tx, shop.id, actor, 'shop.host_added', { host });
    return { outcome: 'added', slug, host };
  });
}

/** Whether the shop's database has a live owner: the fact that decides whether a shop still waits for one. */
async function shopHasOwner(shopUrl: string): Promise<boolean> {
  const pool = createPool(shopUrl, { max: 1, readOnly: true });
  try {
    const owners = await pool.query(
      `SELECT 1 FROM app_user WHERE role = 'owner' AND voided_at IS NULL LIMIT 1`,
    );
    return owners.rowCount === 1;
  } finally {
    await pool.end();
  }
}

/**
 * `make shop-code`: a new setup code for a shop that is served or suspended and has no live
 * owner. The code that was waiting stops working (only one works at a time). The shop's database
 * is only read, to see that it has no owner: a code for a shop that has one would open nothing.
 */
export async function issueShopCode(
  config: AppConfig,
  request: ActorRequest & { readonly slug: string },
  now: Date = new Date(),
): Promise<IssuedSetupCode & { readonly slug: string }> {
  const slug = checkedSlug(request.slug);
  const actor = checkedActor(request.actor);
  requireSetupCodeSecret(config);
  await prepareControlDatabase(config);
  return inControlTransaction(config, async (tx) => {
    const shop = await shopNamed(tx, slug);
    if (shop.state !== 'active' && shop.state !== 'suspended') {
      throw new ShopRefused(
        shop.state === 'provisioning'
          ? `The shop "${slug}" is being made: finish make shop-new first, it makes the first code.`
          : `The shop "${slug}" is closed for good.`,
      );
    }
    let owned: boolean;
    try {
      owned = await shopHasOwner(withDatabase(config.databaseUrl, shop.dbName));
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      throw new ShopRefused(`The database of "${slug}" could not be read (${why}): no code made.`);
    }
    if (owned) {
      throw new ShopRefused(
        `The shop "${slug}" has an owner already: a setup code opens nothing there. ` +
          'The owner signs in; to reset a password use make owner SHOP=<slug>.',
      );
    }
    const issued = await issueSetupCode(tx, { config, shopId: shop.id, actor, now });
    return { ...issued, slug };
  });
}

export type SchemaState = 'current' | 'behind' | 'no database' | 'unreachable';

export interface ShopListing {
  readonly slug: string;
  readonly state: controlSchema.ShopState;
  readonly dbName: string;
  readonly hosts: readonly string[];
  readonly label: string;
  readonly suspendedAt: Date | null;
  readonly suspendedReason: string | null;
  readonly closedAt: Date | null;
  /**
   * Whether the shop's database has every migration of this code. `behind` is a shop whose migration
   * failed or never ran: it answers 503. Not asked for a closed shop.
   */
  readonly schema: SchemaState | null;
  /** Whether the shop has a live owner; null if its database could not be asked. */
  readonly hasOwner: boolean | null;
  /** When the code that is waiting runs out; null if none is waiting. */
  readonly codeExpiresAt: Date | null;
}

/**
 * The code of an error from the database driver (a PostgreSQL SQLSTATE or a system error's name).
 * Drizzle wraps what the driver throws and keeps it as `cause`, so the chain is followed.
 */
function errorCodeOf(error: unknown): string | undefined {
  for (let found: unknown = error; found instanceof Error; found = found.cause) {
    const code: unknown = (found as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

/** What a shop's own database says: its schema, and (if it is current) whether it has an owner. */
async function inspectShop(
  config: AppConfig,
  dbName: string,
): Promise<{ schema: SchemaState; hasOwner: boolean | null }> {
  const shopUrl = withDatabase(config.databaseUrl, dbName);
  const pool = createPool(shopUrl, { max: 1, readOnly: true });
  try {
    const current = await isMigrated(createDatabase(pool));
    if (!current) return { schema: 'behind', hasOwner: null };
    const owners = await pool.query(
      `SELECT 1 FROM app_user WHERE role = 'owner' AND voided_at IS NULL LIMIT 1`,
    );
    return { schema: 'current', hasOwner: owners.rowCount === 1 };
  } catch (error) {
    // 3D000: the database is not there (a shop being made that has not got one yet).
    return {
      schema: errorCodeOf(error) === '3D000' ? 'no database' : 'unreachable',
      hasOwner: null,
    };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/** Every shop, every address in use and every setup code still waiting, read in one go. */
async function readControl(config: AppConfig, now: Date) {
  const pool = createPool(controlDatabaseUrl(config), { max: 1, readOnly: true });
  try {
    const control = createControlDb(pool);
    return {
      shops: await control
        .select()
        .from(controlSchema.shop)
        .orderBy(asc(controlSchema.shop.createdAt), asc(controlSchema.shop.slug)),
      hosts: await control
        .select({ shopId: controlSchema.shopHost.shopId, host: controlSchema.shopHost.host })
        .from(controlSchema.shopHost)
        .where(isNull(controlSchema.shopHost.releasedAt))
        .orderBy(asc(controlSchema.shopHost.createdAt), asc(controlSchema.shopHost.host)),
      codes: await control
        .select({
          shopId: controlSchema.shopSetupCode.shopId,
          expiresAt: controlSchema.shopSetupCode.expiresAt,
        })
        .from(controlSchema.shopSetupCode)
        .where(
          and(
            isNull(controlSchema.shopSetupCode.usedAt),
            isNull(controlSchema.shopSetupCode.revokedAt),
            gt(controlSchema.shopSetupCode.expiresAt, now),
          ),
        ),
    };
  } finally {
    await pool.end();
  }
}

/**
 * `make shop-list`: every shop of the control database, oldest first, with its addresses, its
 * state, whether its database is up to date and has an owner, and whether a setup code is waiting.
 * It reads the shops' databases (through read-only connections) and writes no row, not even an
 * event; the only thing it can do is make and migrate the control database when that is missing,
 * as every command does.
 */
export async function listShops(config: AppConfig, now: Date = new Date()): Promise<ShopListing[]> {
  await prepareControlDatabase(config);
  const { shops, hosts, codes } = await readControl(config, now);
  const listing: ShopListing[] = [];
  for (const shop of shops) {
    const inspected =
      shop.state === 'closed'
        ? { schema: null, hasOwner: null }
        : await inspectShop(config, shop.dbName);
    const waiting = codes
      .filter((code) => code.shopId === shop.id)
      .map((code) => code.expiresAt.getTime());
    listing.push({
      slug: shop.slug,
      state: shop.state,
      dbName: shop.dbName,
      hosts: hosts.filter((row) => row.shopId === shop.id).map((row) => row.host),
      label: shop.label,
      suspendedAt: shop.suspendedAt,
      suspendedReason: shop.suspendedReason,
      closedAt: shop.closedAt,
      schema: inspected.schema,
      hasOwner: inspected.hasOwner,
      codeExpiresAt: waiting.length > 0 ? new Date(Math.max(...waiting)) : null,
    });
  }
  return listing;
}
