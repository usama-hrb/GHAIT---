import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { E2E, SECOND_SHOP, setupCodeVariable, SIGNUP_SHOPS } from './stack';

const WEB_DIR = path.join(import.meta.dirname, '..');
const API_DIR = path.join(WEB_DIR, '../api');

function run(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; input?: string },
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    child.stdin.end(options.input ?? '');
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${String(code)}`));
    });
  });
}

/** Runs a command to its end and returns what it printed (for the one thing it shows once). */
function runForOutput(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} ${args.join(' ')} exited with ${String(code)}`));
    });
  });
}

function start(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('error', (error) => {
    console.error(`${command} failed to start`, error);
  });
  return child;
}

/** Waits until a process we started has really ended, so the next one can take its port. */
function stopped(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else {
      child.once('exit', () => {
        resolve();
      });
    }
    child.kill();
  });
}

/** A leftover server on the port would answer the health checks instead of ours. */
function assertPortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () => {
      reject(
        new Error(
          `Port ${String(port)} is in use: stop the process (or set E2E_API_PORT / E2E_WEB_PORT)`,
        ),
      );
    });
    server.listen(port, '127.0.0.1', () => {
      server.close(() => {
        resolve();
      });
    });
  });
}

async function waitFor(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`${url} did not come up`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/**
 * `E2E_SHOPS=adopted` runs the same specs on a multi-shop server (ADR 0029, Step 4), in the order
 * of the rollout: the server starts as the one-shop server it was, the owner and the cashier are
 * made, the shop is adopted (`make shop-adopt`) for the address the browsers use, and the API is
 * restarted with MULTI_SHOP=true. The specs are not told. Two more shops are made, as
 * `make shop-new` makes them, and wait for their owners: the sign-up wizard is run on them
 * (Step 6, e2e/signup-new-shop.spec.ts). Their setup codes reach the specs in the environment.
 * A third waits for a spec that does more than sign up: it sells there and checks the first shop
 * (Step 9, e2e/second-shop.spec.ts).
 */
const ADOPTED = process.env.E2E_SHOPS === 'adopted';

/**
 * The whole stack, from built artefacts: needs `pnpm --filter @fabric/api build` first (make e2e).
 * Builds the web app with API_PROXY_TARGET so /api goes to this API, like Caddy in production.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  await assertPortFree(E2E.apiPort);
  await assertPortFree(E2E.webPort);
  const postgres = await new PostgreSqlContainer('postgres:16.15-alpine').start();
  const children: ChildProcess[] = [];
  const teardown = async () => {
    for (const child of children) child.kill();
    await postgres.stop();
  };
  try {
    await startApps(postgres.getConnectionUri(), children);
  } catch (error) {
    await teardown();
    throw error;
  }
  return teardown;
}

async function startApps(databaseUrl: string, children: ChildProcess[]): Promise<void> {
  const apiEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(E2E.apiPort),
    DATABASE_URL: databaseUrl,
    MIGRATE_ON_START: 'true',
    LOG_LEVEL: 'warn',
    JWT_ACCESS_SECRET: 'e2e-only-secret-0123456789abcdefghijklmnop',
    // Every test signs one or two browsers in from 127.0.0.1, and each page load refreshes.
    AUTH_LOGIN_RATE_LIMIT: '100',
    AUTH_REFRESH_RATE_LIMIT: '1000',
    // Hashes the setup codes of the shops that wait for an owner (ADR 0029, Step 6).
    ...(ADOPTED ? { SETUP_CODE_SECRET: 'e2e-only-setup-code-secret-0123456789abcdef' } : {}),
  };
  const api = start('node', ['dist/main.js'], API_DIR, apiEnv);
  children.push(api);
  await waitFor(`${E2E.apiUrl}/health`);
  await run(
    'node',
    ['dist/create-owner.js', '--username', E2E.owner.username, '--name', 'صاحب المحل'],
    {
      cwd: API_DIR,
      env: apiEnv,
      input: E2E.owner.password,
    },
  );

  await run(
    'node',
    ['dist/create-cashier-user.js', '--username', E2E.cashier.username, '--name', 'عاملة'],
    { cwd: API_DIR, env: apiEnv, input: E2E.cashier.password },
  );

  if (ADOPTED) {
    await run(
      'node',
      ['dist/shop-adopt.js', '--slug', 'e2e_shop', '--host', '127.0.0.1', '--actor', 'e2e'],
      { cwd: API_DIR, env: apiEnv },
    );
    for (const shop of [...SIGNUP_SHOPS, SECOND_SHOP]) {
      const shown = await runForOutput(
        'node',
        ['dist/shop.js', 'new', '--slug', shop.slug, '--host', shop.host, '--actor', 'e2e'],
        { cwd: API_DIR, env: apiEnv },
      );
      const code = /Setup code[^:]*: ([0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4})/.exec(shown)?.[1];
      if (code === undefined) throw new Error(`shop new "${shop.slug}" showed no setup code`);
      process.env[setupCodeVariable(shop.slug)] = code;
    }
    await stopped(api);
    // The flag is turned on only now: its start-up migrates every shop of the control database.
    children.push(start('node', ['dist/main.js'], API_DIR, { ...apiEnv, MULTI_SHOP: 'true' }));
    await waitFor(`${E2E.apiUrl}/health`);
  }

  const webEnv: NodeJS.ProcessEnv = {
    ...process.env,
    API_PROXY_TARGET: E2E.apiUrl,
    NEXT_TELEMETRY_DISABLED: '1',
  };
  await run('pnpm', ['exec', 'next', 'build'], { cwd: WEB_DIR, env: webEnv });
  children.push(
    start(
      'pnpm',
      ['exec', 'next', 'start', '-p', String(E2E.webPort), '-H', '127.0.0.1'],
      WEB_DIR,
      webEnv,
    ),
  );
  await waitFor(`${E2E.webUrl}/login`);
}
