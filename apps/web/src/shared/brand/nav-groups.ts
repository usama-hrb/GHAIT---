/** Consecutive items with the same `group` sit together; a change of group starts a new one. */
export function groupNav<T extends { group?: string }>(items: readonly T[]): T[][] {
  const groups: T[][] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last[0]?.group === item.group) last.push(item);
    else groups.push([item]);
  }
  return groups;
}

/** What the sidebar and the phone's "more" drawer need to know about an item to place it. */
export interface NavEntry {
  href: string;
  /** The `href` of the item this page sits under (one level only). */
  parent?: string;
  group?: string;
  /** The heading of the item's group; the first item of a group names it. */
  groupLabel?: string;
}

/** An item and the pages that sit under it. */
export interface NavNode<T> {
  item: T;
  children: T[];
}

/**
 * Puts each item that names a `parent` under that item, in list order. An item whose parent is not
 * in the list (a page this role may not open) stays at the top level, and so does an item whose
 * parent is itself under another: there is one level, and nothing a person may open is ever hidden.
 */
export function nestNav<T extends NavEntry>(items: readonly T[]): NavNode<T>[] {
  const byHref = new Map(items.map((item) => [item.href, item]));
  // Under its parent only when the parent is in the list and has no parent of its own there.
  const isNested = (item: T): boolean => {
    const parent = item.parent === undefined ? undefined : byHref.get(item.parent);
    return parent !== undefined && (parent.parent === undefined || !byHref.has(parent.parent));
  };
  return items
    .filter((item) => !isNested(item))
    .map((item) => ({
      item,
      children: items.filter((child) => child.parent === item.href && isNested(child)),
    }));
}

/** One group of the navigation: its heading (if it has one) and its items with their pages. */
export interface NavSection<T> {
  group: string | undefined;
  label: string | undefined;
  nodes: NavNode<T>[];
}

/** The navigation as it is drawn: consecutive items of one group together, pages under their parent. */
export function navSections<T extends NavEntry>(items: readonly T[]): NavSection<T>[] {
  const nodes = nestNav(items);
  return groupNav(nodes.map(({ item }) => item)).map((group) => ({
    group: group[0]?.group,
    label: group[0]?.groupLabel,
    nodes: nodes.filter(({ item }) => group.includes(item)),
  }));
}
