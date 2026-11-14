// `make export` runs: node dist/data-export.js [--shop <slug>] > <file>
// Writes the shop's data as one JSON file (BUILD_PROMPTS 3.6, docs/runbooks/backup.md). On a server
// with many shops (MULTI_SHOP=true) it names the shop: `make export SHOP=<slug>`.
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadConfig } from './load-config.js';
import { DataService } from './modules/data/index.js';
import { checkShopArgument, exitCodeOf, inShop } from './shop-scope.js';

const { values } = parseArgs({ options: { shop: { type: 'string' } } });
const config = loadConfig();
try {
  checkShopArgument(config, values.shop);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(exitCodeOf(error));
}

const app = await NestFactory.createApplicationContext(AppModule.forRoot(config), {
  logger: ['error', 'warn'],
});
try {
  const file = await inShop(app, config, values.shop, () => app.get(DataService).exportAll());
  process.stdout.write(`${JSON.stringify(file)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = exitCodeOf(error);
} finally {
  await app.close();
}
