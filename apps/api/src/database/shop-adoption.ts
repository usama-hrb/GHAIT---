import { and, eq, isNull } from 'drizzle-orm';
import pg from 'pg';
import { type AppConfig, DATABASE_NAME_PATTERN, databaseNameOf } from '../config/index.js';
import { prepareControlDatabase } from './control/migrate.js';
import { inControlTransaction } from './control/operate.js';
import * as controlSchema from './control/schema.js';
import { checkedHost, checkedSlug, ShopRefused } from './shop-names.js';

/** The operator's mistake or a conflict, in words for the operator: the command prints it as it is. */
export class AdoptionRefused extends ShopRefused {
  override readonly name: string = 'AdoptionRefused';
}

const refuse = (message: string): Error => new AdoptionRefused(message);

export interface AdoptionRequest {
  /** The short name the operator will type for this shop (`SHOP=<slug>`). */
  readonly slug: string;
  /** The address devices use today, as `req.hostname` gives it. */
  readonly host: string;
  /** Who is doing it: the operator's login on the server. */
  readonly actor: string;
}

export interface Adoption {
  /** `already`: the control database had this shop, with this address, and nothing was written. */
  readonly outcome: 'adopted' | 'already';
  readonly id: string;
  readonly slug: string;
  readonly host: string;
  readonly dbName: string;
  readonly state: controlSchema.ShopState;
  /** How many migrations the shop's database has applied (the next start applies the rest). */
  readonly migrationsApplied: number;
}

/**
 * Looks at the shop's database, and changes nothing: the session is read-only, so the server
 * refuses a write if one were ever added here. Refuses a database that is not a Fabric shop's
 * (no migrations table): the usual cause is a wrong DATABASE_URL, and adopting an empty database
 * would hand its address to a shop with no schema.
 */
async function inspectShopDatabase(databaseUrl: string, dbName: string): Promise<number> {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 1,
    options: '-c default_transaction_read_only=on',
  });
  // An idle-connection error would otherwise stop the process with an unhandled 'error' event.
  pool.on('error', () => undefined);
  try {
    const table = await pool.query<{ present: boolean }>(
      `SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present`,
    );
    if (!table.rows[0]?.present) {
      throw new AdoptionRefused(
        `The database "${dbName}" has no Fabric schema (no migrations were ever applied to it). ` +
          'Adopt the shop that is live: DATABASE_URL must name its database.',
      );
    }
    const applied = await pool.query<{ count: string }>(
      'SELECT count(*) AS count FROM drizzle.__drizzle_migrations',
    );
    return Number(applied.rows[0]?.count ?? 0);
  } catch (error) {
    if (error instanceof AdoptionRefused) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new AdoptionRefused(`The database "${dbName}" could not be read: ${reason}`);
  } finally {
    await pool.end();
  }
}

/**
 * Adopts the live shop as the first shop of a multi-shop server (ADR 0029, Step 4): its database
 * stays where it is, untouched, and the control database learns it and its address. The shop's
 * database is the one DATABASE_URL names. The control database is made if it is missing, after the
 * shop's database was found to be a real one, so a wrong DATABASE_URL makes nothing.
 *
 * It writes three rows in one transaction, `shop` (state `active`), `shop_host` and `shop_event`
 * (operator actions go there, never into a shop's `audit_log`). Running it again for the same shop
 * and address writes nothing and says `already`. Another shop's name, database or address is a
 * conflict and is refused. It works with MULTI_SHOP off in the environment: the caller passes a
 * config with it on, because the rollout adopts the shop first and flips the flag after.
 */
export async function adoptShop(config: AppConfig, request: AdoptionRequest): Promise<Adoption> {
  if (!config.multiShop)
    throw new Error('Adopting a shop needs a configuration with MULTI_SHOP on');
  const slug = checkedSlug(request.slug, refuse);
  const host = checkedHost(request.host, refuse);
  const actor = request.actor.trim();
  if (!actor) throw new AdoptionRefused('Who is adopting it? The actor is empty.');
  const dbName = databaseNameOf(config.databaseUrl);
  if (!DATABASE_NAME_PATTERN.test(dbName)) {
    throw new AdoptionRefused(
      `The database "${dbName}" cannot be a shop's: its name must be lower-case letters, digits and _, starting with a letter.`,
    );
  }

  const migrationsApplied = await inspectShopDatabase(config.databaseUrl, dbName);
  await prepareControlDatabase(config);

  return inControlTransaction(config, async (tx) => {
    const [bySlug] = await tx
      .select()
      .from(controlSchema.shop)
      .where(eq(controlSchema.shop.slug, slug));
    const [byDatabase] = await tx
      .select()
      .from(controlSchema.shop)
      .where(eq(controlSchema.shop.dbName, dbName));
    const [byHost] = await tx
      .select({ shopId: controlSchema.shopHost.shopId, slug: controlSchema.shop.slug })
      .from(controlSchema.shopHost)
      .innerJoin(controlSchema.shop, eq(controlSchema.shop.id, controlSchema.shopHost.shopId))
      .where(and(eq(controlSchema.shopHost.host, host), isNull(controlSchema.shopHost.releasedAt)));

    if (byDatabase && byDatabase.slug !== slug) {
      throw new AdoptionRefused(
        `The database "${dbName}" is already the shop "${byDatabase.slug}". It cannot be two shops.`,
      );
    }
    if (bySlug && bySlug.dbName !== dbName) {
      throw new AdoptionRefused(
        `The name "${slug}" already belongs to another shop (database "${bySlug.dbName}"): pick another.`,
      );
    }
    if (byHost && byHost.slug !== slug) {
      throw new AdoptionRefused(
        `The address "${host}" already belongs to the shop "${byHost.slug}".`,
      );
    }

    if (bySlug) {
      // The same shop. It is done if the address is one of its own; a new address for a shop is
      // not an adoption, and nothing here may quietly add one.
      if (!byHost) {
        throw new AdoptionRefused(
          `The shop "${slug}" is adopted already, and "${host}" is not one of its addresses. Adopting changes nothing about an existing shop.`,
        );
      }
      return {
        outcome: 'already',
        id: bySlug.id,
        slug,
        host,
        dbName,
        state: bySlug.state,
        migrationsApplied,
      } satisfies Adoption;
    }

    const [created] = await tx
      .insert(controlSchema.shop)
      .values({ slug, dbName, state: 'active' })
      .returning({ id: controlSchema.shop.id });
    if (!created) throw new Error('The shop was not written');
    await tx.insert(controlSchema.shopHost).values({ host, shopId: created.id });
    await tx.insert(controlSchema.shopEvent).values({
      shopId: created.id,
      actor,
      action: 'shop.adopted',
      detail: { host, dbName, migrationsApplied },
    });
    return {
      outcome: 'adopted',
      id: created.id,
      slug,
      host,
      dbName,
      state: 'active',
      migrationsApplied,
    } satisfies Adoption;
  });
}
