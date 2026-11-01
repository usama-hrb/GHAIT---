import 'fake-indexeddb/auto';
import {
  PHOTO_LIMIT_BYTES,
  type PhotoImage,
  type SyncOp,
  SYNC_BATCH_MAX_BYTES,
} from '@fabric/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShopDatabase, type OutboxEntry } from './db';
import { ValidationError } from './errors';
import { createRepositories, type Repositories } from './repositories';
import { LocalStore } from './store';
import { takeBatch } from './sync';

let db: ShopDatabase;
let store: LocalStore;
let repos: Repositories;
let now = new Date('2026-10-31T10:00:00.000Z');

beforeEach(() => {
  now = new Date('2026-10-31T10:00:00.000Z');
  db = new ShopDatabase(`test-${crypto.randomUUID()}`);
  store = new LocalStore(db, () => now);
  repos = createRepositories(store);
});

afterEach(async () => {
  await db.delete();
});

/** A base64 text that decodes to `bytes` bytes and starts like a JPEG. */
function fakeJpeg(bytes: number): string {
  const triples = Math.ceil(bytes / 3);
  const text = `/9j/${'A'.repeat(triples * 4 - 4)}`;
  const drop = triples * 3 - bytes;
  return drop === 0 ? text : `${text.slice(0, text.length - drop)}${'='.repeat(drop)}`;
}

const image = (bytes = 30_000): PhotoImage => ({
  contentType: 'image/jpeg',
  width: 480,
  height: 360,
  byteLength: bytes,
  data: fakeJpeg(bytes),
});

async function aColor(name = 'أحمر'): Promise<string> {
  const fabricId = await repos.fabrics.save({
    name: 'روزا',
    refPricePerMeterCents: 2000,
    minPricePerMeterCents: 1800,
  });
  return repos.variants.save({ fabricId, colorName: name, lowStockThresholdCm: 500 });
}

const tick = () => {
  now = new Date(now.getTime() + 1000);
};

describe('colour photos on the device (ADR 0009)', () => {
  it('give a colour its picture, as an image source, saved with its op for sync', async () => {
    const variantId = await aColor();
    expect((await repos.photos.sources()).size).toBe(0);

    const id = await repos.photos.set(variantId, image());
    const sources = await repos.photos.sources();
    expect(sources.get(variantId)).toBe(`data:image/jpeg;base64,${fakeJpeg(30_000)}`);

    const ops = (await db.outbox.toArray()).filter((op) => op.entity === 'photo');
    expect(ops.map((op) => [op.kind, op.entityId])).toEqual([['upsert', id]]);
    expect(await repos.photos.get(id)).toMatchObject({
      variantId,
      voidedAt: null,
      byteLength: 30_000,
    });
  });

  it('replace the picture: a new photo, the earlier one voided with a reason, never deleted', async () => {
    const variantId = await aColor();
    const first = await repos.photos.set(variantId, image(30_000));
    tick();
    const second = await repos.photos.set(variantId, image(31_000));

    expect((await repos.photos.get(first))?.voidedAt).not.toBeNull();
    expect((await repos.photos.get(second))?.voidedAt).toBeNull();
    expect((await repos.photos.sources()).get(variantId)).toBe(
      `data:image/jpeg;base64,${fakeJpeg(31_000)}`,
    );

    const photoOps = (await db.outbox.toArray()).filter((op) => op.entity === 'photo');
    expect(photoOps.map((op) => op.kind)).toEqual(['upsert', 'upsert', 'void']);
    expect(photoOps[2]).toMatchObject({ entityId: first, payload: { reason: 'replaced' } });
  });

  it('are taken away by voiding, and the colour shows none', async () => {
    const variantId = await aColor();
    const id = await repos.photos.set(variantId, image());
    tick();
    await repos.photos.remove(variantId);

    expect((await repos.photos.sources()).has(variantId)).toBe(false);
    expect((await repos.photos.get(id))?.voidedAt).not.toBeNull();
    expect((await db.outbox.toArray()).at(-1)).toMatchObject({
      kind: 'void',
      payload: { reason: 'removed' },
    });
  });

  it('are kept per colour', async () => {
    const red = await aColor('أحمر');
    const blue = await aColor('أزرق');
    await repos.photos.set(red, image(30_000));
    await repos.photos.set(blue, image(31_000));
    const sources = await repos.photos.sources();
    expect(sources.get(red)).toContain(fakeJpeg(30_000));
    expect(sources.get(blue)).toContain(fakeJpeg(31_000));
  });

  it('refuse what is not a JPEG of the size it says, or too big', async () => {
    const variantId = await aColor();
    await expect(
      repos.photos.set(variantId, { ...image(), data: `iVBO${fakeJpeg(30_000).slice(4)}` }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      repos.photos.set(variantId, { ...image(), byteLength: 29_999 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(repos.photos.set(variantId, image(PHOTO_LIMIT_BYTES + 3))).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await db.photos.count()).toBe(0);
  });

  it('are not added by a cashier, who only sees them', async () => {
    const variantId = await aColor();
    store.setRole('cashier');
    await expect(repos.photos.set(variantId, image())).rejects.toThrow();
    store.setRole('partner');
    await expect(repos.photos.set(variantId, image())).rejects.toThrow();
  });
});

describe('a push is cut by the size of its photos', () => {
  const entry = (entity: SyncOp['entity'], payload: unknown, seq: number): OutboxEntry => ({
    seq,
    opId: crypto.randomUUID(),
    entity,
    entityId: crypto.randomUUID(),
    kind: 'upsert',
    payload,
    deviceId: 'desk',
    clientTs: '2026-10-31T10:00:00.000Z',
    baseServerSeq: null,
    state: 'pending',
    error: null,
  });
  const photoEntry = (bytes: number, seq: number) => entry('photo', { data: fakeJpeg(bytes) }, seq);

  it('takes every small op up to the count', () => {
    const entries = Array.from({ length: 5 }, (_, index) => entry('fabric', { name: 'x' }, index));
    expect(takeBatch(entries)).toHaveLength(5);
  });

  it('stops before the photo that takes the batch over its byte budget', () => {
    const each = photoEntry(150_000, 0).payload as { data: string };
    const fit = Math.floor(SYNC_BATCH_MAX_BYTES / each.data.length);
    const entries = Array.from({ length: fit + 3 }, (_, index) => photoEntry(150_000, index));
    expect(takeBatch(entries)).toHaveLength(fit);
  });

  it('keeps the order, and sends one photo alone when it is over the budget by itself', () => {
    const entries = [photoEntry(150_000, 0), entry('fabric', { name: 'x' }, 1)];
    expect(takeBatch(entries).map((op) => op.seq)).toEqual([0, 1]);
    expect(takeBatch([photoEntry(PHOTO_LIMIT_BYTES, 0)])).toHaveLength(1);
  });
});
