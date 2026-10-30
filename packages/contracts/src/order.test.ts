import { describe, expect, it } from 'vitest';
import { syncOrder } from './index.js';

describe('syncOrder (BUILD_PROMPTS 3.6: clock skew)', () => {
  it('follows server_seq whatever the device clocks said, then local records by creation', () => {
    const records = [
      { id: 'local-2', createdAt: '2026-10-30T10:02:00.000Z', serverSeq: null },
      // A device whose clock was a day behind: made "earlier", reached the server later.
      { id: 'skewed', createdAt: '2026-10-29T10:00:00.000Z', serverSeq: 12 },
      { id: 'first', createdAt: '2026-10-30T09:00:00.000Z', serverSeq: 7 },
      { id: 'local-1', createdAt: '2026-10-30T10:01:00.000Z' },
      { id: 'local-0', createdAt: '2026-10-30T10:01:00.000Z' },
    ];
    expect([...records].sort(syncOrder).map((record) => record.id)).toEqual([
      'first',
      'skewed',
      'local-0',
      'local-1',
      'local-2',
    ]);
  });
});
