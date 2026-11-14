// `node dist/migrate.js` (make migrate): applies pending migrations, then exits.
//   One-shop server:  make migrate
//   MULTI_SHOP=true:  make migrate SHOP=<slug>|all   (see migrate-command.ts)
import { parseArgs } from 'node:util';
import { loadConfig } from './load-config.js';
import { migrateCommand } from './migrate-command.js';

const { values } = parseArgs({ options: { shop: { type: 'string' } } });
process.exitCode = await migrateCommand(loadConfig(), values.shop);
