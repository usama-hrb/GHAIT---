// `make import FILE=<export.json>` runs: node dist/data-import.js < <file>
// Loads an export (the server's, or a device's from its settings screen) into an EMPTY database,
// all or nothing, and starts a new epoch so devices pull it again (docs/runbooks/backup.md).
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadConfig } from './load-config.js';
import { DataService } from './modules/data/index.js';

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);

const app = await NestFactory.createApplicationContext(AppModule.forRoot(loadConfig()), {
  logger: ['error', 'warn'],
});
try {
  const counts = await app
    .get(DataService)
    .importAll(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  for (const [entity, n] of Object.entries(counts)) console.log(`${entity}: ${String(n)}`);
  console.log('Imported. Create the owner account next: make owner USERNAME=…');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await app.close();
}
