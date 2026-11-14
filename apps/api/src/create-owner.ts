// `make owner USERNAME=<name> [NAME="<display name>"]` runs:
//   printf '%s' "$password" | node dist/create-owner.js --username <name> [--name "<display name>"] [--shop <slug>]
// Creates the shop owner's account, or sets a new password for it (signing it out everywhere).
// The password comes on stdin so it never appears in the process list or the shell history. On a
// server with many shops (MULTI_SHOP=true) the command names its shop: `make owner SHOP=<slug> …`.
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadConfig } from './load-config.js';
import { AuthService } from './modules/auth/index.js';
import { checkShopArgument, exitCodeOf, inShop } from './shop-scope.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/\r?\n$/, '');
}

const { values } = parseArgs({
  options: { username: { type: 'string' }, name: { type: 'string' }, shop: { type: 'string' } },
});
if (!values.username) {
  console.error(
    'usage: printf %s "$PASSWORD" | node dist/create-owner.js --username <name> [--name <display name>] [--shop <slug>]',
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
const password = await readStdin();

const app = await NestFactory.createApplicationContext(AppModule.forRoot(config), {
  logger: ['error', 'warn'],
});
try {
  const outcome = await inShop(app, config, values.shop, () =>
    app.get(AuthService).setOwner({
      username,
      password,
      displayName: values.name,
    }),
  );
  console.log(
    outcome === 'created' ? 'Owner created.' : 'Owner password changed; all sessions signed out.',
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = exitCodeOf(error);
} finally {
  await app.close();
}
