// `make cashier-user USERNAME=<name> [NAME="<display name>"]` runs:
//   printf '%s' "$password" | node dist/create-cashier-user.js --username <name> [--name "<display name>"] [--shop <slug>]
// Creates a cashier account (BUILD_PROMPTS 5.3: sells, never sees a cost or a profit), or sets a new password for it
// (signing it out everywhere). The password comes on stdin, never in argv or the shell history. On a
// server with many shops (MULTI_SHOP=true) the command names its shop: `make cashier-user SHOP=<slug> …`.
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadConfig } from './load-config.js';
import { AuthService } from './modules/auth/index.js';
import { checkShopArgument, exitCodeOf, inShop } from './shop-scope.js';

const chunks: Buffer[] = [];
const { values } = parseArgs({
  options: { username: { type: 'string' }, name: { type: 'string' }, shop: { type: 'string' } },
});
if (!values.username) {
  console.error(
    'usage: printf %s "$PASSWORD" | node dist/create-cashier-user.js --username <name> [--name <display name>] [--shop <slug>]',
  );
  process.exit(2);
}
const { username } = values;
const config = loadConfig();
try {
  checkShopArgument(config, values.shop);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(exitCodeOf(error));
}
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
const password = Buffer.concat(chunks)
  .toString('utf8')
  .replace(/\r?\n$/, '');

const app = await NestFactory.createApplicationContext(AppModule.forRoot(config), {
  logger: ['error', 'warn'],
});
try {
  const outcome = await inShop(app, config, values.shop, () =>
    app.get(AuthService).setCashierUser({
      username,
      password,
      displayName: values.name,
    }),
  );
  console.log(
    outcome === 'created'
      ? 'Cashier account created (sells; sees no cost or profit).'
      : 'Cashier password changed; all its sessions signed out.',
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = exitCodeOf(error);
} finally {
  await app.close();
}
