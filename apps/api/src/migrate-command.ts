import type { AppConfig } from './config/index.js';
import { migrateShops, prepareControlDatabase, runMigrations } from './database/index.js';

/** Where the command's lines go: the terminal, or a test. */
export interface Output {
  log(line: string): void;
  error(line: string): void;
}

const USAGE =
  'usage: make migrate SHOP=<slug>|all   (node dist/migrate.js --shop <slug>|all)\n' +
  'With MULTI_SHOP=true the command names its shop: a slug, or "all" for every shop that is not closed.';

/**
 * `make migrate` (ADR 0029). One-shop server: the migrations of its database, as ever. With
 * MULTI_SHOP the control database comes first, then the shops asked for (`shop` is a slug, or `all`
 * for every shop that is not closed). Every shop asked for is tried, and any failure gives exit
 * code 1. Returns the exit code: 0 done, 1 a migration failed, 2 the command was used wrongly.
 */
export async function migrateCommand(
  config: AppConfig,
  shop: string | undefined,
  out: Output = console,
): Promise<number> {
  if (!config.multiShop) {
    if (shop !== undefined) {
      out.error('SHOP is only for MULTI_SHOP=true: this server has one shop.');
      return 2;
    }
    await runMigrations(config.databaseUrl);
    out.log('Migrations applied.');
    return 0;
  }
  if (!shop) {
    out.error(USAGE);
    return 2;
  }
  await prepareControlDatabase(config);
  let results;
  try {
    results = await migrateShops(config, shop === 'all' ? undefined : shop);
  } catch (error) {
    out.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const failed = results.filter((result) => result.outcome === 'failed');
  if (failed.length > 0) {
    const slugs = failed.map((result) => result.slug).join(', ');
    out.error(
      `${failed.length} of ${results.length} shops failed: ${slugs}. ` +
        'They answer 503 until they are fixed and migrated again.',
    );
    return 1;
  }
  out.log(`Migrations applied for ${results.length} shops.`);
  return 0;
}
