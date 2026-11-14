import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMultiShopApp, type MultiShopApp } from './support/multi-shop-app.js';

/**
 * The prod stack's nightly backup (`infra/docker/backup/nightly.sh`, ADR 0029 Step 8) on a real
 * Postgres: one dump for each shop that is not closed and one for the control database, in
 * `<root>/<slug>/` and `<root>/control/`, with rotation that works on one directory at a time and
 * touches only the files of that database. The script runs once (`BACKUP_ONCE=1`) with the host's
 * `pg_dump`, `pg_restore` and `psql`; without them the file is skipped, as the container has them.
 */

const script = fileURLToPath(new URL('../../../infra/docker/backup/nightly.sh', import.meta.url));
const hasPostgresTools = ['pg_dump', 'pg_restore', 'psql'].every(
  (tool) => spawnSync(tool, ['--version'], { stdio: 'ignore' }).status === 0,
);

interface Run {
  status: number | null;
  out: string;
  err: string;
}

function runNightly(multi: MultiShopApp, root: string, env: Record<string, string> = {}): Run {
  const url = new URL(multi.adminUrl);
  const result = spawnSync('sh', [script], {
    encoding: 'utf8',
    env: {
      PATH: process.env['PATH'] ?? '',
      PGHOST: url.hostname,
      PGPORT: url.port,
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      BACKUP_ONCE: '1',
      BACKUP_ROOT: root,
      BACKUP_KEEP: '2',
      MULTI_SHOP: 'true',
      CONTROL_DATABASE_NAME: multi.controlDatabaseName,
      ...env,
    },
  });
  return { status: result.status, out: result.stdout, err: result.stderr };
}

/** Files that stand in for the dumps of an earlier night. */
function seed(dir: string, names: string[]): void {
  mkdirSync(dir, { recursive: true });
  for (const name of names) writeFileSync(join(dir, name), 'an earlier night');
}

const old = (db: string, day: number): string =>
  `${db}_202001${String(day).padStart(2, '0')}T000000Z.dump`;

/** The dumps of one database in one directory, named as the script names them. */
function dumpsOf(dir: string, db: string): string[] {
  if (!existsSync(dir)) return [];
  const own = new RegExp(`^${db}_\\d{8}T\\d{6}Z\\.dump$`);
  return readdirSync(dir)
    .filter((name) => own.test(name))
    .sort();
}

/** The name of the database of a shop that the test made. */
function databaseOf(multi: MultiShopApp, slug: string): string {
  const shop = multi.shops[slug];
  if (!shop) throw new Error(`the test has no shop ${slug}`);
  return shop.databaseName;
}

function dumpedDatabase(file: string): string | undefined {
  const listing = spawnSync('pg_restore', ['--list', file], { encoding: 'utf8' }).stdout;
  return /^;\s+dbname: (\S+)$/m.exec(listing)?.[1];
}

describe.skipIf(!hasPostgresTools)('nightly backup', () => {
  let multi: MultiShopApp;
  const roots: string[] = [];
  const db = (slug: string): string => databaseOf(multi, slug);

  beforeAll(async () => {
    multi = await createMultiShopApp([
      { slug: 'shop_a', host: 'a.nightly.test' },
      { slug: 'shop_b', host: 'b.nightly.test', state: 'suspended' },
      { slug: 'shop_c', host: 'c.nightly.test', state: 'provisioning', database: 'missing' },
      { slug: 'shop_gone', host: 'gone.nightly.test', state: 'closed' },
    ]);
  }, 60_000);
  afterAll(async () => {
    await multi.close();
  });

  const freshRoot = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'nightly-'));
    roots.push(dir);
    return dir;
  };
  afterAll(() => {
    for (const dir of roots) rmSync(dir, { recursive: true, force: true });
  });

  it('dumps each shop that is not closed and the control database, each into its own folder', () => {
    const dir = freshRoot();
    const run = runNightly(multi, dir);
    expect(run.status, run.err).toBe(0);

    expect(dumpsOf(join(dir, 'shop_a'), db('shop_a'))).toHaveLength(1);
    // A suspended shop is still backed up: it is the shop that is closed to requests, not its data.
    expect(dumpsOf(join(dir, 'shop_b'), db('shop_b'))).toHaveLength(1);
    expect(dumpsOf(join(dir, 'control'), multi.controlDatabaseName)).toHaveLength(1);
    // Closed: nothing is dumped. Provisioning without a database: skipped, and not a failure.
    expect(existsSync(join(dir, 'shop_gone'))).toBe(false);
    expect(existsSync(join(dir, 'shop_c'))).toBe(false);
    expect(run.out).toContain('skipped: shop_c has no database yet');
    expect(readdirSync(dir).sort()).toEqual(['control', 'shop_a', 'shop_b']);

    // Each dump is of its own database and can be read back.
    const folders: [folder: string, database: string][] = [
      ['shop_a', db('shop_a')],
      ['shop_b', db('shop_b')],
      ['control', multi.controlDatabaseName],
    ];
    for (const [folder, database] of folders) {
      const [dump] = dumpsOf(join(dir, folder), database);
      expect(dump, folder).toBeDefined();
      expect(dumpedDatabase(join(dir, folder, dump ?? '')), folder).toBe(database);
    }
  });

  it('prunes one folder at a time and only the files of its own database', () => {
    const dir = freshRoot();
    const a = db('shop_a');
    seed(join(dir, 'shop_a'), [
      old(a, 1),
      old(a, 2),
      old(a, 3),
      // A file that begins with the database name but is not one of its dumps, and a stranger.
      `${a}_two_20200101T000000Z.dump`,
      'notes.txt',
    ]);
    seed(
      join(dir, 'shop_b'),
      [1, 2, 3, 4, 5].map((day) => old(db('shop_b'), day)),
    );
    // A closed shop's folder is not visited at all.
    seed(
      join(dir, 'shop_gone'),
      [1, 2, 3].map((day) => old(db('shop_gone'), day)),
    );
    seed(
      join(dir, 'control'),
      [1, 2, 3].map((day) => old(multi.controlDatabaseName, day)),
    );

    const run = runNightly(multi, dir);
    expect(run.status, run.err).toBe(0);

    // The newest two: the one just made and the newest of the old ones.
    const inA = dumpsOf(join(dir, 'shop_a'), a);
    expect(inA).toHaveLength(2);
    expect(inA).toContain(old(a, 3));
    expect(inA).not.toContain(old(a, 1));
    expect(readdirSync(join(dir, 'shop_a'))).toEqual(
      expect.arrayContaining([`${a}_two_20200101T000000Z.dump`, 'notes.txt']),
    );

    const inB = dumpsOf(join(dir, 'shop_b'), db('shop_b'));
    expect(inB).toHaveLength(2);
    expect(inB).toContain(old(db('shop_b'), 5));

    expect(dumpsOf(join(dir, 'control'), multi.controlDatabaseName)).toHaveLength(2);
    expect(dumpsOf(join(dir, 'shop_gone'), db('shop_gone'))).toEqual(
      [1, 2, 3].map((day) => old(db('shop_gone'), day)),
    );
  });

  it('leaves no half-written file behind', () => {
    const dir = freshRoot();
    expect(runNightly(multi, dir).status).toBe(0);
    for (const folder of readdirSync(dir)) {
      expect(readdirSync(join(dir, folder)).filter((name) => name.endsWith('.partial'))).toEqual(
        [],
      );
    }
  });

  it('refuses a BACKUP_KEEP that is not a positive whole number', () => {
    const dir = freshRoot();
    for (const keep of ['0', 'two', '-1', '1.5']) {
      const run = runNightly(multi, dir, { BACKUP_KEEP: keep });
      expect(run.status, `BACKUP_KEEP=${keep}`).toBe(2);
    }
    expect(readdirSync(dir)).toEqual([]);
  });

  it('on a one-shop server keeps one flat folder and removes only the files of its own database', () => {
    const dir = freshRoot();
    const a = db('shop_a');
    const other = db('shop_b');
    seed(
      dir,
      [1, 2, 3].flatMap((day) => [old(a, day), old(other, day)]),
    );

    const run = runNightly(multi, dir, { MULTI_SHOP: 'false', PGDATABASE: a });
    expect(run.status, run.err).toBe(0);

    expect(dumpsOf(dir, a)).toHaveLength(2);
    expect(dumpsOf(dir, other)).toEqual([1, 2, 3].map((day) => old(other, day)));
    expect(readdirSync(dir).filter((name) => !name.endsWith('.dump'))).toEqual([]);
  });

  it('ends as a failure when the list of shops cannot be read, and still tries the control database', () => {
    const dir = freshRoot();
    const run = runNightly(multi, dir, { CONTROL_DATABASE_NAME: 'no_such_control_database' });
    expect(run.status).toBe(1);
    expect(run.err).toContain('cannot read the list of shops');
    expect(run.err).toContain('backup FAILED for no_such_control_database');
    expect(existsSync(join(dir, 'shop_a'))).toBe(false);
  });
});

describe.skipIf(!hasPostgresTools)('nightly backup when one shop cannot be dumped', () => {
  let multi: MultiShopApp;
  let root: string;

  beforeAll(async () => {
    // The first shop is active but its database is gone; the others come after it in the list.
    multi = await createMultiShopApp([
      { slug: 'shop_lost', host: 'lost.nightly.test', database: 'missing' },
      { slug: 'shop_ok', host: 'ok.nightly.test' },
    ]);
    root = mkdtempSync(join(tmpdir(), 'nightly-fail-'));
  }, 60_000);
  afterAll(async () => {
    await multi.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('dumps the others and the control database, and ends as a failure', () => {
    const lost = databaseOf(multi, 'shop_lost');
    const run = runNightly(multi, root);
    expect(run.status).toBe(1);
    expect(run.err).toContain(`backup FAILED for ${lost}`);

    expect(dumpsOf(join(root, 'shop_ok'), databaseOf(multi, 'shop_ok'))).toHaveLength(1);
    expect(dumpsOf(join(root, 'control'), multi.controlDatabaseName)).toHaveLength(1);
    // Nothing of the lost shop is left, not even a half-written file.
    expect(readdirSync(join(root, 'shop_lost'))).toEqual([]);
  });
});
