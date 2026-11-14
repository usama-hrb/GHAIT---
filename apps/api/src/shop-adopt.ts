// `make shop-adopt SLUG=<name> HOST=<address>` runs:
//   node dist/shop-adopt.js --slug <name> --host <address> --actor "$(id -un)"
// Adopts the shop that is live (the database in DATABASE_URL) as the first shop of a multi-shop
// server (ADR 0029, Step 4). It works with MULTI_SHOP off in the environment: that is how the
// rollout runs it, before the flag is turned on.
import { parseArgs } from 'node:util';
import { loadConfig } from './load-config.js';
import { adoptCommand } from './shop-adopt-command.js';

const { values } = parseArgs({
  options: { slug: { type: 'string' }, host: { type: 'string' }, actor: { type: 'string' } },
});
process.exitCode = await adoptCommand(loadConfig({ MULTI_SHOP: 'true' }), values);
