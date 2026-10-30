# Runbook: API accounts, secrets and migrations

These steps work for both stacks; add `STACK=prod` on the server (the default is `STACK=dev`). The stack must be running (`make up`). Design: [ADR 0003](../adr/0003-orm.md) (Drizzle), [ADR 0004](../adr/0004-api-foundation.md) (auth, audit).

## First start on a new server

1. In `.env`, set a real `POSTGRES_PASSWORD` and `JWT_ACCESS_SECRET`:

   ```sh
   openssl rand -hex 24      # POSTGRES_PASSWORD
   openssl rand -base64 48   # JWT_ACCESS_SECRET
   ```

   In production the API refuses to start while `JWT_ACCESS_SECRET` still contains `change-me`.

2. Start the stack with `make up STACK=prod`. The API applies the migrations before it listens.
3. Create the owner account:

   ```sh
   make owner STACK=prod USERNAME=owner NAME="صاحب المحل"
   ```

   You are asked for the password (12 characters or more). It is not echoed and never appears in the process list or the shell history. The account creation is in `audit_log`.

There is no sign-up page and no setup route: the owner account exists only through this command.

## Forgotten password

Run the same command with the existing username:

```sh
make owner STACK=prod USERNAME=owner
```

It sets the new password and signs the owner out on every device (all refresh tokens are revoked). It refuses a different username while an owner exists.

## Rotate the access-token secret

Change `JWT_ACCESS_SECRET` in `.env`, then `make up STACK=prod`.

Access tokens signed with the old secret stop working at once. Clients get a new one with their refresh cookie (refresh tokens do not depend on this secret), so nobody has to sign in again. To also sign every device out, reset the password as above.

## Migrations

- **Apply:** the API applies pending migrations on start. `make migrate [STACK=prod]` does it by hand in the running api container.
- **Create** (development, on the host):

  ```sh
  make migrate-new NAME=add_fabric             # SQL generated from apps/api/src/database/schema
  make migrate-new NAME=fabric_views CUSTOM=1  # empty file for hand-written SQL
  ```

  Review the generated SQL and commit it with the schema change. CI fails when the schema and the migrations disagree.

- **Every new table** uses `baseColumns('<table>')` in its schema. Its migration calls `SELECT install_row_guards('<table>', <append_only>);`, which refuses DELETE/TRUNCATE, blocks UPDATE on append-only tables, and sets `server_seq`. `test/database.e2e-spec.ts` fails for a table without them.
- Take a backup before applying migrations on the server: `make backup STACK=prod` ([backup runbook](backup.md)).

## Logs

`make logs SERVICE=api [STACK=prod]` shows JSON lines (pino). Every response has an `x-request-id` header. The same id is in that request's log lines, in its error body (`error.requestId`), and in the audit entries it wrote. Search the logs for it.
