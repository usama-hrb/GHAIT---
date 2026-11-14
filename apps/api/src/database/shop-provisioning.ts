import { and, eq, isNull } from 'drizzle-orm';
import type { AppConfig } from '../config/index.js';
import { prepareControlDatabase } from './control/migrate.js';
import { type ControlTx, inControlTransaction } from './control/operate.js';
import * as controlSchema from './control/schema.js';
import { databaseExists, ensureDatabase } from './create-database.js';
import { withDatabase } from './database-url.js';
import { createPool } from './client.js';
import { runMigrations } from './migrate.js';
import { checkedHost, checkedSlug, databaseNameForSlug, ShopRefused } from './shop-names.js';
import { reasonOf } from './shop-migrations.js';
import { type IssuedSetupCode, issueSetupCode, requireSetupCodeSecret } from './setup-code.js';

export interface ShopRequest {
  /** The short name the operator will type for this shop (`SHOP=<slug>`). */
  readonly slug: string;
  /** The address the shop is served at; none yet is allowed (`make shop-host` adds one later). */
  readonly host?: string | undefined;
  /** The operator's own note about the shop. */
  readonly label?: string | undefined;
  /** Who is doing it: the operator's login on the server. */
  readonly actor: string;
}

/** What one run of `shop-new` did, step by step; a step that was done already is not listed. */
export type ProvisioningStep = 'row' | 'database' | 'address' | 'activated';

export interface Provisioned {
  readonly id: string;
  readonly slug: string;
  readonly dbName: string;
  readonly host: string | null;
  /** The shop was being made by an earlier run that stopped half way, and this run went on. */
  readonly resumed: boolean;
  readonly steps: readonly ProvisioningStep[];
  readonly migrationsApplied: number;
  readonly setupCode: IssuedSetupCode;
}

/** The longest note about a shop: it is the operator's, not a place for a document. */
const LABEL_MAX = 200;

async function liveHost(tx: ControlTx, host: string) {
  const [row] = await tx
    .select({ shopId: controlSchema.shopHost.shopId, slug: controlSchema.shop.slug })
    .from(controlSchema.shopHost)
    .innerJoin(controlSchema.shop, eq(controlSchema.shop.id, controlSchema.shopHost.shopId))
    .where(and(eq(controlSchema.shopHost.host, host), isNull(controlSchema.shopHost.releasedAt)));
  return row;
}

/** How many migrations the database has applied (Drizzle's own table). */
async function countMigrations(databaseUrl: string): Promise<number> {
  const pool = createPool(databaseUrl, { max: 1 });
  try {
    const result = await pool.query<{ count: string }>(
      'SELECT count(*) AS count FROM drizzle.__drizzle_migrations',
    );
    return Number(result.rows[0]?.count ?? 0);
  } finally {
    await pool.end();
  }
}

/**
 * `make shop-new` (ADR 0029 section 6, Step 5): makes a new shop and its first setup code. It is
 * a series of steps, because CREATE DATABASE cannot run in a transaction, and each step looks
 * first at whether it was done already, so the command can be run again with the same arguments
 * after it stopped half way and goes on from where it was:
 *
 *   1. the control row, in the state `provisioning` (nothing serves it yet: its address answers 503);
 *   2. the shop's database, `shop_<slug>`;
 *   3. all the migrations of the shop;
 *   4. the address, when one is given;
 *   5. the setup code and the state `active`, together in one transaction: the code is shown only
 *      after that commits, and a code is never made for a shop that did not become active.
 *
 * It refuses before it writes anything when the name is bad or taken, when the address belongs to
 * another shop, or when a database of that name exists that no shop owns (it will not take over
 * a database it did not make). A shop that exists and is not `provisioning` is refused too: a
 * second `shop-new` for a name in use is a mistake, not a repeat. It never drops a database.
 * `now` is when it is run (the code's expiry follows from it).
 */
export async function provisionShop(
  config: AppConfig,
  request: ShopRequest,
  now: Date = new Date(),
): Promise<Provisioned> {
  const slug = checkedSlug(request.slug);
  const host = request.host === undefined ? undefined : checkedHost(request.host);
  const label = (request.label ?? '').trim();
  const actor = request.actor.trim();
  if (!actor) throw new ShopRefused('Who is making it? The actor is empty.');
  if (label.length > LABEL_MAX) throw new ShopRefused(`The label is longer than ${LABEL_MAX}.`);
  // Before anything is made: a shop whose code cannot be made is not worth starting.
  requireSetupCodeSecret(config);

  await prepareControlDatabase(config);
  const steps: ProvisioningStep[] = [];

  // 1. The control row.
  const shop = await inControlTransaction(config, async (tx) => {
    const [existing] = await tx
      .select()
      .from(controlSchema.shop)
      .where(eq(controlSchema.shop.slug, slug));
    if (existing && existing.state !== 'provisioning') {
      throw new ShopRefused(
        `The shop "${slug}" exists already (${existing.state}). make shop-new makes new shops. ` +
          'A new setup code: make shop-code. Another address: make shop-host.',
      );
    }
    const dbName = existing?.dbName ?? databaseNameForSlug(slug);
    if (host !== undefined) {
      const used = await liveHost(tx, host);
      if (used && used.shopId !== existing?.id) {
        throw new ShopRefused(`The address "${host}" already belongs to the shop "${used.slug}".`);
      }
    }
    if (existing) return { id: existing.id, dbName, resumed: true };

    const [owner] = await tx
      .select({ slug: controlSchema.shop.slug })
      .from(controlSchema.shop)
      .where(eq(controlSchema.shop.dbName, dbName));
    if (owner) {
      throw new ShopRefused(
        `The database "${dbName}" is already the shop "${owner.slug}". Pick another name.`,
      );
    }
    if (await databaseExists(config.databaseUrl, dbName)) {
      throw new ShopRefused(
        `A database "${dbName}" exists on this server and no shop owns it. make shop-new will not ` +
          'take over a database it did not make: pick another name, or move that database away.',
      );
    }
    const [created] = await tx
      .insert(controlSchema.shop)
      .values({ slug, dbName, state: 'provisioning', label })
      .returning({ id: controlSchema.shop.id });
    if (!created) throw new Error('The shop was not written');
    await tx.insert(controlSchema.shopEvent).values({
      shopId: created.id,
      actor,
      action: 'shop.created',
      detail: { dbName, label, host: host ?? null },
    });
    steps.push('row');
    return { id: created.id, dbName, resumed: false };
  });

  // 2. The database.
  if (await ensureDatabase(config.databaseUrl, shop.dbName)) steps.push('database');

  // 3. The migrations. A failure leaves the shop `provisioning`, so it answers 503 and the same
  //    command goes on from here once the cause is removed.
  const shopUrl = withDatabase(config.databaseUrl, shop.dbName);
  try {
    await runMigrations(shopUrl);
  } catch (error) {
    throw new ShopRefused(
      `The migration of the new shop "${slug}" failed and changed nothing (${reasonOf(error)}). ` +
        'The shop stays being made and answers 503. Fix the cause and run the same command again.',
    );
  }
  const migrationsApplied = await countMigrations(shopUrl);

  // 4 and 5. The address, then the code and the state.
  const setupCode = await inControlTransaction(config, async (tx) => {
    if (host !== undefined) {
      const used = await liveHost(tx, host);
      if (used && used.shopId !== shop.id) {
        throw new ShopRefused(`The address "${host}" already belongs to the shop "${used.slug}".`);
      }
      if (!used) {
        await tx.insert(controlSchema.shopHost).values({ host, shopId: shop.id, createdAt: now });
        await tx.insert(controlSchema.shopEvent).values({
          shopId: shop.id,
          actor,
          action: 'shop.host_added',
          detail: { host },
        });
        steps.push('address');
      }
    }
    const [current] = await tx
      .select({ state: controlSchema.shop.state })
      .from(controlSchema.shop)
      .where(eq(controlSchema.shop.id, shop.id));
    if (current?.state !== 'provisioning') {
      throw new ShopRefused(
        `The shop "${slug}" is ${current?.state ?? 'gone'} now: another command changed it while this one ran.`,
      );
    }
    const issued = await issueSetupCode(tx, { config, shopId: shop.id, actor, now });
    await tx
      .update(controlSchema.shop)
      .set({ state: 'active' })
      .where(eq(controlSchema.shop.id, shop.id));
    await tx.insert(controlSchema.shopEvent).values({
      shopId: shop.id,
      actor,
      action: 'shop.activated',
      detail: { dbName: shop.dbName, host: host ?? null },
    });
    steps.push('activated');
    return issued;
  });

  return {
    id: shop.id,
    slug,
    dbName: shop.dbName,
    host: host ?? null,
    resumed: shop.resumed,
    steps,
    migrationsApplied,
    setupCode,
  };
}
