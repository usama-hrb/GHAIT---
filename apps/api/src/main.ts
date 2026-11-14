import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureHttp } from './common/index.js';
import { migrateShops, prepareControlDatabase, runMigrations } from './database/index.js';
import { loadConfig } from './load-config.js';

const config = loadConfig();
// One API instance serves all shops: applying migrations before listening is safe. The control
// database (multi-shop mode only) comes first, then each shop's, one after the other. A shop whose
// migration fails is logged and answers 503 while the others serve (ADR 0029).
if (config.migrateOnStart) {
  await prepareControlDatabase(config);
  if (config.multiShop) await migrateShops(config);
  else await runMigrations(config.databaseUrl);
}
const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
  bufferLogs: true,
});
configureHttp(app);
app.enableShutdownHooks();
await app.listen(config.port);
