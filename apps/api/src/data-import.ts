// `make import FILE=<export.json>` runs: node dist/data-import.js [--shop <slug>] < <file>
// Loads an export (the server's, or a device's from its settings screen) into an EMPTY database,
// all or nothing, and starts a new epoch so devices pull it again (docs/runbooks/backup.md). On a
// server with many shops (MULTI_SHOP=true) it names the shop: `make import SHOP=<slug> FILE=…`.
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

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);

const app = await NestFactory.createApplicationContext(AppModule.forRoot(config), {
  logger: ['error', 'warn'],
});
try {
  const counts = await inShop(app, config, values.shop, () =>
    app.get(DataService).importAll(JSON.parse(Buffer.concat(chunks).toString('utf8'))),
  );
  for (const [entity, n] of Object.entries(counts)) console.log(`${entity}: ${String(n)}`);
  console.log(
    `Imported. Create the owner account next: make owner ${values.shop ? `SHOP=${values.shop} ` : ''}USERNAME=…`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = exitCodeOf(error);
} finally {
  await app.close();
}
