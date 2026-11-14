import type { AppConfig } from './config/index.js';
import { adoptShop, AdoptionRefused } from './database/index.js';
import type { Output } from './migrate-command.js';

const USAGE =
  'usage: make shop-adopt SLUG=<name> HOST=<address devices use today>\n' +
  '       (node dist/shop-adopt.js --slug <name> --host <address> [--actor <who>])';

export interface AdoptArguments {
  readonly slug?: string;
  readonly host?: string;
  readonly actor?: string;
}

/**
 * `make shop-adopt` (ADR 0029, Step 4): the live shop becomes the first shop of a multi-shop
 * server. It only reads the shop's database and writes the control database. `config` has
 * MULTI_SHOP on whatever the environment says, because the rollout adopts the shop first and turns
 * the flag on after. Returns the exit code: 0 adopted (or adopted already), 1 refused or failed,
 * 2 the command was used wrongly.
 */
export async function adoptCommand(
  config: AppConfig,
  args: AdoptArguments,
  out: Output = console,
): Promise<number> {
  if (!args.slug || !args.host) {
    out.error(USAGE);
    return 2;
  }
  try {
    const adoption = await adoptShop(config, {
      slug: args.slug,
      host: args.host,
      actor: args.actor ?? 'operator',
    });
    if (adoption.outcome === 'already') {
      out.log(
        `Shop "${adoption.slug}" is adopted already (${adoption.state}, address ${adoption.host}). Nothing was written.`,
      );
      return 0;
    }
    out.log(
      `Adopted the database "${adoption.dbName}" as shop "${adoption.slug}" (active), address ${adoption.host}. ` +
        `Its database was only read: ${adoption.migrationsApplied} migrations applied, nothing changed in it.`,
    );
    out.log(
      'Next: set MULTI_SHOP=true and restart the API. Its start-up migrates every shop in the control database.',
    );
    return 0;
  } catch (error) {
    out.error(
      error instanceof AdoptionRefused
        ? error.message
        : `Adopting failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}
