// `make owner USERNAME=<name> [NAME="<display name>"]` runs:
//   printf '%s' "$password" | node dist/create-owner.js --username <name> [--name "<display name>"]
// Creates the shop owner's account, or sets a new password for it (signing it out everywhere).
// The password comes on stdin so it never appears in the process list or the shell history.
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadConfig } from './load-config.js';
import { AuthService } from './modules/auth/index.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/\r?\n$/, '');
}

const { values } = parseArgs({
  options: { username: { type: 'string' }, name: { type: 'string' } },
});
if (!values.username) {
  console.error(
    'usage: printf %s "$PASSWORD" | node dist/create-owner.js --username <name> [--name <display name>]',
  );
  process.exit(2);
}
const password = await readStdin();

const app = await NestFactory.createApplicationContext(AppModule.forRoot(loadConfig()), {
  logger: ['error', 'warn'],
});
try {
  const outcome = await app.get(AuthService).setOwner({
    username: values.username,
    password,
    displayName: values.name,
  });
  console.log(
    outcome === 'created' ? 'Owner created.' : 'Owner password changed; all sessions signed out.',
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await app.close();
}
