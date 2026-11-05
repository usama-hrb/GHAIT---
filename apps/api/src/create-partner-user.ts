// `make partner-user USERNAME=<name> PARTNER=<partner name or id> [NAME="<display name>"]` runs:
//   printf '%s' "$password" | node dist/create-partner-user.js --username <name> --partner <partner> [--name "<display name>"]
// Creates the login of a partner who already exists (ADR 0024), or sets a new password for it
// (signing it out everywhere). It never makes a partner: add the partner in Settings first. The
// password comes on stdin, never in argv or the shell history.
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadConfig } from './load-config.js';
import { AccountsService } from './modules/accounts/index.js';

const chunks: Buffer[] = [];
const { values } = parseArgs({
  options: { username: { type: 'string' }, partner: { type: 'string' }, name: { type: 'string' } },
});
if (!values.username || !values.partner) {
  console.error(
    'usage: printf %s "$PASSWORD" | node dist/create-partner-user.js --username <name> --partner <partner name or id> [--name <display name>]',
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
  const outcome = await app.get(AccountsService).setPartnerLogin({
    partner: values.partner,
    username: values.username,
    password,
    displayName: values.name,
  });
  console.log(
    outcome === 'created'
      ? 'Partner account created (read-only, linked to the partner).'
      : 'Partner password changed; all its sessions signed out.',
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await app.close();
}
