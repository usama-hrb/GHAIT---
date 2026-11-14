// The operator's shop commands (ADR 0029, Step 5) run:
//   node dist/shop.js <new|list|suspend|resume|code|host|close> [--slug <name>] [--host <address>]
//     [--label <note>] [--reason <why>] [--confirm <name>] [--actor "$(id -un)"]
// through `make shop-new`, `shop-list`, `shop-suspend`, `shop-resume`, `shop-code`, `shop-host` and
// `shop-close`. They work with MULTI_SHOP off in the environment, as `shop-adopt` does: the
// shops are made before the flag is turned on.
import { parseArgs } from 'node:util';
import { loadConfig } from './load-config.js';
import { shopCommand } from './shop-commands.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    slug: { type: 'string' },
    host: { type: 'string' },
    label: { type: 'string' },
    reason: { type: 'string' },
    confirm: { type: 'string' },
    actor: { type: 'string' },
  },
});
process.exitCode = await shopCommand(loadConfig({ MULTI_SHOP: 'true' }), positionals[0], values);
