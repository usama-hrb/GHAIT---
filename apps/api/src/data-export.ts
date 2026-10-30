// `make export` runs: node dist/data-export.js > <file>
// Writes the shop's data as one JSON file (BUILD_PROMPTS 3.6, docs/runbooks/backup.md).
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadConfig } from './load-config.js';
import { DataService } from './modules/data/index.js';

const app = await NestFactory.createApplicationContext(AppModule.forRoot(loadConfig()), {
  logger: ['error', 'warn'],
});
try {
  process.stdout.write(`${JSON.stringify(await app.get(DataService).exportAll())}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await app.close();
}
