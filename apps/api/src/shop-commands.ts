import type { AppConfig } from './config/index.js';
import {
  addShopHost,
  closeShop,
  formatSetupCode,
  issueShopCode,
  listShops,
  provisionShop,
  resumeShop,
  SETUP_CODE_VALID_DAYS,
  type ShopListing,
  ShopRefused,
  suspendShop,
} from './database/index.js';
import type { Output } from './migrate-command.js';

const USAGE = [
  'usage: make shop-new SLUG=<name> [HOST=<address>] [LABEL="<note>"]   make a shop and its setup code',
  '       make shop-list                                               the shops, their state and addresses',
  '       make shop-suspend SLUG=<name> REASON="<why>"                  refuse a shop until it is resumed',
  '       make shop-resume SLUG=<name>                                  serve a suspended shop again',
  '       make shop-code SLUG=<name>                                    a new setup code (the shop has no owner yet)',
  '       make shop-host SLUG=<name> HOST=<address>                     one more address for a shop',
  '       make shop-close SLUG=<name> REASON="<why>" CONFIRM=<name>     end a shop for good (data stays)',
  '       (node dist/shop.js <command> --slug <name> [--host …] [--label …] [--reason …] [--confirm …] [--actor <who>])',
].join('\n');

export interface ShopArguments {
  readonly slug?: string | undefined;
  readonly host?: string | undefined;
  readonly label?: string | undefined;
  readonly reason?: string | undefined;
  readonly confirm?: string | undefined;
  readonly actor?: string | undefined;
}

const day = (date: Date): string => date.toISOString().slice(0, 10);

function row(shop: ShopListing): string[] {
  const owner = shop.hasOwner === null ? '-' : shop.hasOwner ? 'yes' : 'no';
  const note =
    shop.state === 'suspended' && shop.suspendedReason
      ? `suspended: ${shop.suspendedReason}`
      : shop.label;
  return [
    shop.slug,
    shop.state,
    shop.hosts.length > 0 ? shop.hosts.join(',') : '-',
    shop.schema ?? '-',
    owner,
    shop.codeExpiresAt ? `until ${day(shop.codeExpiresAt)}` : '-',
    note,
  ];
}

/** A table of the shops, columns padded to their widest cell; the last column is left as it is. */
function table(shops: readonly ShopListing[]): string[] {
  const rows = [
    ['SLUG', 'STATE', 'ADDRESSES', 'SCHEMA', 'OWNER', 'CODE', 'NOTE'],
    ...shops.map(row),
  ];
  const widths =
    rows[0]?.map((_, column) => Math.max(...rows.map((cells) => cells[column]?.length ?? 0))) ?? [];
  return rows.map((cells) =>
    cells
      .map((cell, column) =>
        column === cells.length - 1 ? cell : cell.padEnd(widths[column] ?? 0),
      )
      .join('  ')
      .trimEnd(),
  );
}

/**
 * The shop commands of the operator (ADR 0029 section 6 and 9, Step 5): `make shop-new`,
 * `shop-list`, `shop-suspend`, `shop-resume`, `shop-code`, `shop-host` and `shop-close`. There is
 * no web page, no role and no route for them: only the person who runs the server can. `config`
 * has MULTI_SHOP on whatever the environment says, as for `shop-adopt`, because the shops are made
 * before the flag is turned on. Returns the exit code: 0 done (or done already), 1 refused or
 * failed, 2 the command was used wrongly.
 */
export async function shopCommand(
  config: AppConfig,
  command: string | undefined,
  args: ShopArguments,
  out: Output = console,
): Promise<number> {
  const actor = args.actor ?? 'operator';
  const needs = (...names: (keyof ShopArguments)[]): boolean => {
    const missing = names.filter((name) => !args[name]);
    if (missing.length === 0) return true;
    out.error(`${command ?? ''}: missing ${missing.map((name) => name.toUpperCase()).join(', ')}`);
    out.error(USAGE);
    return false;
  };
  try {
    switch (command) {
      case 'new': {
        if (!needs('slug')) return 2;
        const made = await provisionShop(config, {
          slug: args.slug ?? '',
          host: args.host,
          label: args.label,
          actor,
        });
        out.log(
          `${made.resumed ? 'Went on with' : 'Made'} the shop "${made.slug}" (active). ` +
            `Database ${made.dbName}: ${made.migrationsApplied} migrations applied. ` +
            `Address: ${made.host ?? 'none yet (make shop-host adds one)'}.`,
        );
        out.log(
          `Setup code, shown once, one use, valid ${SETUP_CODE_VALID_DAYS} days: ${formatSetupCode(made.setupCode.code)}`,
        );
        out.log(
          'Give it to the owner: it lets them make the owner account at the sign-up page of the shop. ' +
            'It is not stored; if it is lost, make shop-code makes a new one.',
        );
        return 0;
      }
      case 'list': {
        const shops = await listShops(config);
        if (shops.length === 0) {
          out.log('No shops yet. make shop-new makes one; make shop-adopt adopts the live shop.');
          return 0;
        }
        for (const line of table(shops)) out.log(line);
        const behind = shops.filter(
          (shop) => shop.schema === 'behind' || shop.schema === 'unreachable',
        );
        if (behind.length > 0) {
          out.log(
            `\n${behind.map((shop) => shop.slug).join(', ')}: not current or not reachable, so it answers 503. ` +
              'make migrate SHOP=<name> after the cause is fixed.',
          );
        }
        return 0;
      }
      case 'suspend': {
        if (!needs('slug', 'reason')) return 2;
        const result = await suspendShop(config, {
          slug: args.slug ?? '',
          reason: args.reason,
          actor,
        });
        out.log(
          result.outcome === 'already'
            ? `The shop "${result.slug}" is suspended already. Nothing was written.`
            : `Suspended the shop "${result.slug}". It answers 403 within 30 seconds; its tablets keep selling offline. make shop-resume undoes it.`,
        );
        return 0;
      }
      case 'resume': {
        if (!needs('slug')) return 2;
        const result = await resumeShop(config, { slug: args.slug ?? '', actor });
        out.log(
          result.outcome === 'already'
            ? `The shop "${result.slug}" is served already. Nothing was written.`
            : `Resumed the shop "${result.slug}". It is served again within 30 seconds, and its tablets sync what they sold.`,
        );
        return 0;
      }
      case 'code': {
        if (!needs('slug')) return 2;
        const issued = await issueShopCode(config, { slug: args.slug ?? '', actor });
        out.log(
          `New setup code for "${issued.slug}", shown once, one use, valid ${SETUP_CODE_VALID_DAYS} days: ${formatSetupCode(issued.code)}`,
        );
        if (issued.replaced > 0) out.log('The code that was waiting no longer works.');
        return 0;
      }
      case 'host': {
        if (!needs('slug', 'host')) return 2;
        const result = await addShopHost(config, {
          slug: args.slug ?? '',
          host: args.host ?? '',
          actor,
        });
        out.log(
          result.outcome === 'already'
            ? `"${result.host}" is an address of the shop "${result.slug}" already. Nothing was written.`
            : `The shop "${result.slug}" now answers at "${result.host}" too (within 30 seconds).`,
        );
        return 0;
      }
      case 'close': {
        if (!needs('slug')) return 2;
        const result = await closeShop(config, {
          slug: args.slug ?? '',
          reason: args.reason,
          confirm: args.confirm,
          actor,
        });
        out.log(
          result.outcome === 'already'
            ? `The shop "${result.slug}" is closed already. Nothing was written.`
            : `Closed the shop "${result.slug}" for good. Its addresses stop answering within 30 seconds. ` +
                'Its database and every row stay on the server; nothing was dropped.',
        );
        return 0;
      }
      default:
        out.error(USAGE);
        return 2;
    }
  } catch (error) {
    out.error(
      error instanceof ShopRefused
        ? error.message
        : `The command failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}
