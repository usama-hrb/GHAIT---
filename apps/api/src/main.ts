import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureHttp } from './common/index.js';
import { runMigrations } from './database/index.js';
import { loadConfig } from './load-config.js';

const config = loadConfig();
// One API instance per shop: applying migrations before listening is safe.
if (config.migrateOnStart) await runMigrations(config.databaseUrl);
const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
  bufferLogs: true,
});
configureHttp(app);
app.enableShutdownHooks();
await app.listen(config.port);
