import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { E2E } from './stack';

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

function start(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('error', (error) => {
    console.error(`${command} failed to start`, error);
  });
  return child;
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
    // Every test signs one or two browsers in from 127.0.0.1.
    AUTH_LOGIN_RATE_LIMIT: '100',
  };
  children.push(start('node', ['dist/main.js'], API_DIR, apiEnv));
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
