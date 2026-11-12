import { describe, expect, it } from 'vitest';
import { groupNav, navSections, nestNav } from './nav-groups';

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

const page = (
  href: string,
  extra: { group?: string; groupLabel?: string; parent?: string } = {},
) => ({
  href,
  ...extra,
});

describe('nestNav', () => {
  it('puts a page under its parent, in list order, and leaves the rest at the top', () => {
    const nodes = nestNav([
      page('/reports'),
      page('/integrity', { parent: '/reports' }),
      page('/audit'),
      page('/anomalies', { parent: '/reports' }),
    ]);
    expect(nodes.map((node) => [node.item.href, node.children.map((child) => child.href)])).toEqual(
      [
        ['/reports', ['/integrity', '/anomalies']],
        ['/audit', []],
      ],
    );
  });

  it('keeps a page whose parent is not in the list at the top level', () => {
    // A role that may open the page but not its parent (the parent was filtered out).
    const nodes = nestNav([page('/integrity', { parent: '/reports' }), page('/audit')]);
    expect(nodes.map((node) => node.item.href)).toEqual(['/integrity', '/audit']);
    expect(nodes.every((node) => node.children.length === 0)).toBe(true);
  });

  it('has one level: a page under a page that is itself under another stays visible', () => {
    const nodes = nestNav([page('/a'), page('/b', { parent: '/a' }), page('/c', { parent: '/b' })]);
    // /c names /b, which is itself nested: /c is shown at the top rather than lost.
    expect(nodes.map((node) => node.item.href)).toEqual(['/a', '/c']);
    expect(nodes[0]?.children.map((child) => child.href)).toEqual(['/b']);
  });

  it('has no nodes for no items', () => {
    expect(nestNav([])).toEqual([]);
  });
});

describe('navSections', () => {
  it('names each group by its first item and keeps the pages with their parent', () => {
    const sections = navSections([
      page('/home', { group: 'main', groupLabel: 'Main' }),
      page('/pos', { group: 'main', groupLabel: 'Main' }),
      page('/reports', { group: 'reports' }),
      page('/integrity', { group: 'reports', parent: '/reports' }),
      page('/settings', { group: 'admin', groupLabel: 'Administration' }),
    ]);
    expect(
      sections.map((section) => [
        section.group,
        section.label,
        section.nodes.map((node) => [node.item.href, node.children.map((child) => child.href)]),
      ]),
    ).toEqual([
      [
        'main',
        'Main',
        [
          ['/home', []],
          ['/pos', []],
        ],
      ],
      ['reports', undefined, [['/reports', ['/integrity']]]],
      ['admin', 'Administration', [['/settings', []]]],
    ]);
  });

  it('drops a group whose items the role may not open, and its heading with it', () => {
    const sections = navSections([page('/home', { group: 'main', groupLabel: 'Main' })]);
    expect(sections).toHaveLength(1);
  });
});
