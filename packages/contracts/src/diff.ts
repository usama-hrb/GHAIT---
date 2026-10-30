/**
 * The first path where two JSON values differ, or null when equal. Internal (not exported from
 * the package): the server compares what a builder gives with what a device sent.
 */
export function firstDifference(
  expected: unknown,
  actual: unknown,
  path: (string | number)[] = [],
): (string | number)[] | null {
  if (Object.is(expected, actual)) return null;
  if (
    typeof expected !== 'object' ||
    typeof actual !== 'object' ||
    expected === null ||
    actual === null
  ) {
    return path;
  }
  if (Array.isArray(expected) !== Array.isArray(actual)) return path;
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const key of keys) {
    const step = Array.isArray(expected) ? Number(key) : key;
    const difference = firstDifference(
      (expected as Record<string, unknown>)[key],
      (actual as Record<string, unknown>)[key],
      [...path, step],
    );
    if (difference) return difference;
  }
  return null;
}
