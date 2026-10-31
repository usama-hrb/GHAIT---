import 'fake-indexeddb/auto';
import { type AuditListResponse } from '@fabric/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NetworkError } from './api';
import { AuditRepository } from './audit';
import { ShopDatabase } from './db';
import type { ServerLink } from './settlements';
import { LocalStore } from './store';

let db: ShopDatabase;
let online = true;
const calls: string[] = [];

const page = (entity: string): AuditListResponse => ({
  items: [
    {
      id: crypto.randomUUID(),
      at: '2026-11-03T09:00:00.000Z',
      actorId: null,
      actorName: null,
      entity,
      entityId: crypto.randomUUID(),
      action: 'create',
      before: null,
      after: { name: 'x' },
      reason: null,
      requestId: null,
    },
  ],
  nextCursor: null,
});

const server: ServerLink = {
  syncNow: () => Promise.resolve(),
  request: (path, schema) => {
    calls.push(path);
    if (!online) return Promise.reject(new NetworkError('offline'));
    if (path === '/audit/actors') {
      return Promise.resolve(
        schema.parse([{ id: crypto.randomUUID(), displayName: 'صاحب المحل', role: 'owner' }]),
      );
    }
    const entity = new URLSearchParams(path.split('?')[1]).get('entity') ?? 'fabric';
    return Promise.resolve(schema.parse(page(entity)));
  },
};

beforeEach(() => {
  online = true;
  calls.length = 0;
  db = new ShopDatabase(`test-${crypto.randomUUID()}`);
});

afterEach(async () => {
  await db.delete();
});

describe('the audit log on the device (BUILD_PROMPTS 4.4)', () => {
  it('is read from the server; offline, the last searches come from this device’s copy', async () => {
    const audit = new AuditRepository(new LocalStore(db), server);
    expect((await audit.list({})).cached).toBe(false);
    expect((await audit.list({ entity: 'expense' })).items[0]?.entity).toBe('expense');
    expect(calls).toEqual(['/audit?limit=50', '/audit?limit=50&entity=expense']);
    expect(await audit.actors()).toHaveLength(1);

    online = false;
    const cached = await audit.list({});
    expect(cached).toMatchObject({
      cached: true,
      items: [expect.objectContaining({ entity: 'fabric' })],
    });
    expect((await audit.list({ entity: 'expense' })).cached).toBe(true);
    await expect(audit.list({ entity: 'sale' })).rejects.toBeInstanceOf(NetworkError);
    expect(await audit.actors()).toHaveLength(1);
  });

  it('without a server link (tests) it needs the server', async () => {
    const audit = new AuditRepository(new LocalStore(db));
    await expect(audit.list({})).rejects.toThrow('The audit log is on the server');
    expect(await audit.actors()).toEqual([]);
  });
});
