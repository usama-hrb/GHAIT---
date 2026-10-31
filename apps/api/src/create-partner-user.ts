// `make partner-user USERNAME=<name> [NAME="<display name>"]` runs:
//   printf '%s' "$password" | node dist/create-partner-user.js --username <name> [--name "<display name>"]
// Creates the partner's read-only account (BUILD_PROMPTS 4.2), or sets a new password for it
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
    'usage: printf %s "$PASSWORD" | node dist/create-partner-user.js --username <name> [--name <display name>]',
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
  const outcome = await app.get(AuthService).setPartnerUser({
    username: values.username,
    password,
    displayName: values.name,
  });
  console.log(
    outcome === 'created'
      ? 'Partner account created (read-only).'
      : 'Partner password changed; all its sessions signed out.',
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await app.close();
}
