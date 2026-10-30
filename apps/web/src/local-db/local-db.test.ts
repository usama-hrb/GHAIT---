import 'fake-indexeddb/auto';
import type { SyncOpResult } from '@fabric/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient, type FetchLike } from './api';
import { ShopDatabase } from './db';
import { ValidationError } from './errors';
import { createRepositories, type Repositories } from './repositories';
import { Session } from './session';
import { LocalStore } from './store';
import { applyPulledChanges, applyPushResults, SyncEngine } from './sync';

const ROSA = { name: 'روزا', refPricePerMeterCents: 2000, minPricePerMeterCents: 1800 };
let clock = new Date('2026-10-29T10:00:00.000Z');

let db: ShopDatabase;
let store: LocalStore;
let repos: Repositories;

beforeEach(() => {
  db = new ShopDatabase(`test-${crypto.randomUUID()}`);
  store = new LocalStore(db, () => clock);
  repos = createRepositories(store);
});

afterEach(async () => {
  await db.delete();
});

describe('repositories', () => {
  it('saves the record and queues its op in one go', async () => {
    const id = await repos.fabrics.save(ROSA);
    const fabric = await repos.fabrics.get(id);
    expect(fabric).toMatchObject({
      ...ROSA,
      id,
      serverSeq: null,
      voidedAt: null,
      deviceId: await store.deviceId(),
    });
    const [op] = await db.outbox.toArray();
    expect(op).toMatchObject({
      entity: 'fabric',
      entityId: id,
      kind: 'upsert',
      baseServerSeq: null,
      state: 'pending',
      payload: { ...ROSA, id },
    });
  });

  it('keeps createdAt on update and bases the op on the synced version', async () => {
    const id = await repos.fabrics.save(ROSA);
    await db.fabrics.update(id, { serverSeq: 7 });
    clock = new Date('2026-10-29T11:00:00.000Z');
    await repos.fabrics.save({ ...ROSA, name: 'روزا 2' }, id);
    const fabric = await repos.fabrics.get(id);
    expect(fabric).toMatchObject({
      name: 'روزا 2',
      createdAt: '2026-10-29T10:00:00.000Z',
      updatedAt: '2026-10-29T11:00:00.000Z',
      serverSeq: 7,
    });
    const ops = await db.outbox.orderBy('seq').toArray();
    expect(ops.map((op) => op.baseServerSeq)).toEqual([null, 7]);
  });

  it('refuses invalid input with the contract’s issues and writes nothing', async () => {
    const error: unknown = await repos.fabrics
      .save({ ...ROSA, minPricePerMeterCents: 2500 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).issues).toEqual([
      expect.objectContaining({
        path: ['minPricePerMeterCents'],
        message: 'min_price_above_ref_price',
      }),
    ]);
    expect(await db.fabrics.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('voids instead of deleting, once, with the reason in the op', async () => {
    const id = await repos.fabrics.save(ROSA);
    await repos.fabrics.void(id, 'أُدخل مرتين');
    await repos.fabrics.void(id, 'again');
    expect((await repos.fabrics.get(id))?.voidedAt).toBe(clock.toISOString());
    const ops = await db.outbox.orderBy('seq').toArray();
    expect(ops.map((op) => [op.kind, op.payload])).toEqual([
      ['upsert', expect.anything()],
      ['void', { reason: 'أُدخل مرتين' }],
    ]);
    await expect(repos.fabrics.void(id, ' ')).rejects.toBeInstanceOf(ValidationError);
    await expect(repos.fabrics.void(crypto.randomUUID(), 'x')).rejects.toThrow(/No fabric/);
  });

  it('lists live records, searched the Arabic-friendly way', async () => {
    await repos.fabrics.save({ ...ROSA, name: 'كريب كوريا', type: 'كريب' });
    const voided = await repos.fabrics.save({ ...ROSA, name: 'قديم' });
    await repos.fabrics.void(voided, 'x');
    await repos.fabrics.save({ ...ROSA, name: 'أرجوان', tags: ['صيفي'] });
    expect((await repos.fabrics.list()).map((f) => f.name)).toEqual(['أرجوان', 'كريب كوريا']);
    expect((await repos.fabrics.list('ارجوان')).map((f) => f.name)).toEqual(['أرجوان']);
    expect((await repos.fabrics.list('صيفي')).map((f) => f.name)).toEqual(['أرجوان']);
  });

  it('lists and counts colours per fabric', async () => {
    const fabricId = await repos.fabrics.save(ROSA);
    await repos.variants.save({ fabricId, colorName: 'أحمر' });
    const blue = await repos.variants.save({ fabricId, colorName: 'أزرق' });
    await repos.variants.save({ fabricId, colorName: 'أخضر' });
    await repos.variants.void(blue, 'لا يوجد');
    expect((await repos.variants.listByFabric(fabricId)).map((v) => v.colorName)).toEqual([
      'أحمر',
      'أخضر',
    ]);
    expect((await repos.variants.countByFabric()).get(fabricId)).toBe(2);
  });

  it('reads a pulled setting by effective date, with the default otherwise', async () => {
    expect(await repos.settings.get('money_display_unit', '2026-10-29')).toBe('rial');
    await db.settings.put({
      id: crypto.randomUUID(),
      key: 'money_display_unit',
      value: 'dirham',
      effectiveFrom: '2026-11-01',
      createdAt: clock.toISOString(),
      updatedAt: clock.toISOString(),
      deviceId: 'server',
      voidedAt: null,
      serverSeq: 3,
    });
    expect(await repos.settings.get('money_display_unit', '2026-10-31')).toBe('rial');
    expect(await repos.settings.get('money_display_unit', '2026-11-01')).toBe('dirham');
  });
});

describe('applying the server’s answers', () => {
  it('push results: applied and conflict leave the outbox, rejected stays marked', async () => {
    const a = await repos.fabrics.save(ROSA);
    const b = await repos.fabrics.save({ ...ROSA, name: 'ب' });
    const c = await repos.fabrics.save({ ...ROSA, name: 'ج' });
    const entries = await db.outbox.orderBy('seq').toArray();
    const results: SyncOpResult[] = [
      { opId: entries[0]?.opId ?? '', status: 'applied', serverSeq: 11, error: null },
      { opId: entries[1]?.opId ?? '', status: 'conflict', serverSeq: 12, error: null },
      {
        opId: entries[2]?.opId ?? '',
        status: 'duplicate',
        originalStatus: 'rejected',
        serverSeq: null,
        error: { code: 'validation_failed', message: 'Invalid record' },
      },
    ];
    await applyPushResults(db, entries, results);
    expect((await repos.fabrics.get(a))?.serverSeq).toBe(11);
    expect((await repos.fabrics.get(b))?.serverSeq).toBeNull();
    const left = await db.outbox.toArray();
    expect(left).toEqual([
      expect.objectContaining({ entityId: c, state: 'rejected', error: results[2]?.error }),
    ]);
  });

  it('pulled changes: stored with their server_seq, except records with a pending change', async () => {
    const local = await repos.fabrics.save({ ...ROSA, name: 'محلي' });
    const remote = { ...(await repos.fabrics.get(local)), name: 'من الخادم' };
    const other = { ...remote, id: crypto.randomUUID(), name: 'جديد من جهاز آخر' };
    await applyPulledChanges(db, {
      changes: [
        { entity: 'fabric', serverSeq: 21, record: remote },
        { entity: 'fabric', serverSeq: 22, record: other },
        { entity: 'fabric', serverSeq: 23, record: { not: 'a fabric' } },
      ],
      nextSince: 23,
      hasMore: false,
      epoch: crypto.randomUUID(),
    });
    expect((await repos.fabrics.get(local))?.name).toBe('محلي');
    expect(await repos.fabrics.get(other.id)).toMatchObject({
      name: 'جديد من جهاز آخر',
      serverSeq: 22,
    });
    expect(await store.getMeta('pullCursor')).toBe(23);
  });
});

/** A tiny in-memory stand-in for the API's auth and sync routes. */
function fakeServer() {
  const records: { entity: string; serverSeq: number; record: unknown }[] = [];
  let seq = 0;
  let refreshValid = true;
  let epoch = crypto.randomUUID();
  const pushSizes: number[] = [];
  const calls: string[] = [];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const token = {
    accessToken: 'token',
    tokenType: 'Bearer',
    expiresIn: 900,
    user: { id: crypto.randomUUID(), username: 'owner', displayName: 'صاحب المحل', role: 'owner' },
  };
  const fetchFn: FetchLike = (input, init) => {
    const url = new URL(input, 'http://shop.test');
    calls.push(`${init.method ?? 'GET'} ${url.pathname}`);
    if (url.pathname === '/api/auth/login') return Promise.resolve(json(200, token));
    if (url.pathname === '/api/devices/register') return Promise.resolve(json(200, { code: 'A' }));
    if (url.pathname === '/api/auth/refresh') {
      return Promise.resolve(
        refreshValid
          ? json(200, token)
          : json(401, { error: { code: 'unauthorized', message: 'no' } }),
      );
    }
    if (url.pathname === '/api/sync/push') {
      const { ops } = JSON.parse(init.body as string) as {
        ops: { opId: string; entity: string; payload: unknown }[];
      };
      pushSizes.push(ops.length);
      const results = ops.map((op) => {
        seq += 1;
        records.push({ entity: op.entity, serverSeq: seq, record: op.payload });
        return { opId: op.opId, status: 'applied', serverSeq: seq, error: null };
      });
      return Promise.resolve(json(200, { results }));
    }
    if (url.pathname === '/api/sync/pull') {
      const since = Number(url.searchParams.get('since'));
      const limit = Number(url.searchParams.get('limit') ?? 200);
      const after = records.filter((change) => change.serverSeq > since);
      const changes = after.slice(0, limit);
      return Promise.resolve(
        json(200, {
          changes,
          nextSince: changes.at(-1)?.serverSeq ?? since,
          hasMore: after.length > limit,
          epoch,
        }),
      );
    }
    return Promise.resolve(json(404, { error: { code: 'not_found', message: url.pathname } }));
  };
  /** The server's database restored from an older copy: only the first `keep` records, a new epoch. */
  const restore = (keep: number) => {
    records.splice(keep);
    seq = records.at(-1)?.serverSeq ?? 0;
    epoch = crypto.randomUUID();
  };
  return {
    fetchFn,
    records,
    calls,
    pushSizes,
    restore,
    expireRefresh: () => (refreshValid = false),
    token,
  };
}

describe('session and sync engine', () => {
  it('signs in, pushes the outbox, pulls, and a second device gets the change', async () => {
    const server = fakeServer();
    const session = new Session(store, new ApiClient(store, server.fetchFn));
    await session.load();
    expect(session.getState().status).toBe('signed_out');
    await session.login({ username: 'owner', password: 'x' });
    expect(session.getState()).toMatchObject({ status: 'signed_in', user: { username: 'owner' } });

    const id = await repos.fabrics.save(ROSA);
    const engine = new SyncEngine(store, session, { isOnline: () => true });
    await engine.syncNow();
    expect(engine.getStatus().state).toBe('idle');
    expect(await db.outbox.count()).toBe(0);
    expect((await repos.fabrics.get(id))?.serverSeq).toBe(1);

    // A second device (another browser profile): its own database, same server.
    const otherDb = new ShopDatabase(`test-${crypto.randomUUID()}`);
    const otherStore = new LocalStore(otherDb);
    const otherSession = new Session(otherStore, new ApiClient(otherStore, server.fetchFn));
    await otherSession.login({ username: 'owner', password: 'x' });
    await new SyncEngine(otherStore, otherSession, { isOnline: () => true }).syncNow();
    expect(await createRepositories(otherStore).fabrics.get(id)).toMatchObject({
      name: 'روزا',
      serverSeq: 1,
    });
    await otherDb.delete();
  });

  it('a large backlog goes in batches of 200, and pulls page by page (BUILD_PROMPTS 3.6)', async () => {
    const server = fakeServer();
    const session = new Session(store, new ApiClient(store, server.fetchFn));
    await session.login({ username: 'owner', password: 'x' });
    for (let index = 0; index < 450; index++) {
      await repos.fabrics.save({ ...ROSA, name: `قماش ${String(index)}` });
    }
    await new SyncEngine(store, session, { isOnline: () => true }).syncNow();
    expect(server.pushSizes).toEqual([200, 200, 50]);
    expect(await db.outbox.count()).toBe(0);

    const otherDb = new ShopDatabase(`test-${crypto.randomUUID()}`);
    const otherStore = new LocalStore(otherDb);
    const otherSession = new Session(otherStore, new ApiClient(otherStore, server.fetchFn));
    await otherSession.login({ username: 'owner', password: 'x' });
    await new SyncEngine(otherStore, otherSession, { isOnline: () => true }).syncNow();
    expect(await otherDb.fabrics.count()).toBe(450);
    expect(
      server.calls.filter((call) => call === 'GET /api/sync/pull').length,
    ).toBeGreaterThanOrEqual(4);
    await otherDb.delete();
  });

  it('after the server is restored (a new epoch), pulls everything again from 0', async () => {
    const server = fakeServer();
    const session = new Session(store, new ApiClient(store, server.fetchFn));
    await session.login({ username: 'owner', password: 'x' });
    const kept = await repos.fabrics.save({ ...ROSA, name: 'قبل النسخة' });
    await repos.fabrics.save({ ...ROSA, name: 'بعد النسخة' });
    const engine = new SyncEngine(store, session, { isOnline: () => true });
    await engine.syncNow();
    expect(await store.getMeta('pullCursor')).toBe(2);

    // Restored from a backup taken after the first fabric; a new one is then added there.
    server.restore(1);
    server.records.push({
      entity: 'fabric',
      serverSeq: 2,
      record: {
        ...(await repos.fabrics.get(kept)),
        id: crypto.randomUUID(),
        name: 'بعد الاسترجاع',
      },
    });
    await engine.syncNow();
    const names = (await db.fabrics.toArray()).map((fabric) => fabric.name);
    // Without the reset the cursor (2) would skip the server's new record 2.
    expect(names).toContain('بعد الاسترجاع');
    expect(await store.getMeta('pullCursor')).toBe(2);
  });

  it('stays usable offline and when the session is refused', async () => {
    const server = fakeServer();
    const session = new Session(store, new ApiClient(store, server.fetchFn));
    let online = false;
    const engine = new SyncEngine(store, session, { isOnline: () => online, retryMinMs: 60_000 });

    await session.login({ username: 'owner', password: 'x' });
    await repos.fabrics.save(ROSA);
    await engine.syncNow();
    expect(engine.getStatus().state).toBe('offline');
    expect(await db.outbox.count()).toBe(1);

    // Back online, but the refresh cookie expired meanwhile: sign in again; the op waits.
    online = true;
    server.expireRefresh();
    (session as unknown as { token: null }).token = null;
    await engine.syncNow();
    expect(engine.getStatus().state).toBe('signed_out');
    expect(session.getState().needsSignIn).toBe(true);
    expect(await db.outbox.count()).toBe(1);
    expect(server.calls).not.toContain('POST /api/sync/push');
  });

  it('remembers the user on the device across restarts, and forgets it on logout', async () => {
    const server = fakeServer();
    const session = new Session(store, new ApiClient(store, server.fetchFn));
    await session.login({ username: 'owner', password: 'x' });
    const restarted = new Session(store, new ApiClient(store, server.fetchFn));
    await restarted.load();
    expect(restarted.getState()).toMatchObject({
      status: 'signed_in',
      user: { username: 'owner' },
    });
    await restarted.logout();
    expect(restarted.getState().status).toBe('signed_out');
    await restarted.load();
    expect(restarted.getState().user).toBeNull();
  });
});
