// `node dist/migrate.js` (make migrate): applies pending migrations, then exits.
import { runMigrations } from './database/index.js';
import { loadConfig } from './load-config.js';

await runMigrations(loadConfig().databaseUrl);
console.log('Migrations applied.');
