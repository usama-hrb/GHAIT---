// `make cashier-user USERNAME=<name> [NAME="<display name>"]` runs:
//   printf '%s' "$password" | node dist/create-cashier-user.js --username <name> [--name "<display name>"]
// Creates a cashier account (BUILD_PROMPTS 5.3: sells, never sees a cost or a profit), or sets a new password for it
// (signing it out everywhere). The password comes on stdin, never in argv or the shell history.
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadConfig } from './load-config.js';
import { AuthService } from './modules/auth/index.js';

const chunks: Buffer[] = [];
const { values } = parseArgs({
  options: { username: { type: 'string' }, name: { type: 'string' } },
});
if (!values.username) {
  console.error(
    'usage: printf %s "$PASSWORD" | node dist/create-cashier-user.js --username <name> [--name <display name>]',
  );
  process.exit(2);
}
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
const password = Buffer.concat(chunks)
  .toString('utf8')
  .replace(/\r?\n$/, '');

const app = await NestFactory.createApplicationContext(AppModule.forRoot(loadConfig()), {
  logger: ['error', 'warn'],
});
try {
  const outcome = await app.get(AuthService).setCashierUser({
    username: values.username,
    password,
    displayName: values.name,
  });
  console.log(
    outcome === 'created'
      ? 'Cashier account created (sells; sees no cost or profit).'
      : 'Cashier password changed; all its sessions signed out.',
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await app.close();
}
