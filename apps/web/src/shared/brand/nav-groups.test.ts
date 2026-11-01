import { describe, expect, it } from 'vitest';
import { groupNav } from './nav-groups';

const item = (href: string, group?: string) => ({ href, group });

describe('groupNav', () => {
  it('sets consecutive items of one group together, in order', () => {
    const groups = groupNav([
      item('/a', 'daily'),
      item('/b', 'daily'),
      item('/c', 'money'),
      item('/d', 'system'),
      item('/e', 'system'),
    ]);
    expect(groups.map((group) => group.map((entry) => entry.href))).toEqual([
      ['/a', '/b'],
      ['/c'],
      ['/d', '/e'],
    ]);
  });

  it('puts items without a group in one group, and starts a new one when the group changes back', () => {
    expect(groupNav([item('/a'), item('/b')])).toHaveLength(1);
    expect(groupNav([item('/a', 'x'), item('/b', 'y'), item('/c', 'x')])).toHaveLength(3);
  });

  it('has no group for no items', () => {
    expect(groupNav([])).toEqual([]);
  });
});
