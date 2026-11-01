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
