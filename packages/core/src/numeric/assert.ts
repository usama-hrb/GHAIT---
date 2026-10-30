/** Throws unless `value` is a safe integer >= `min`. For validated domain inputs, not user text. */
export function assertInteger(value: number, name: string, min = Number.MIN_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer, got ${String(value)}`);
  }
  if (value < min) throw new RangeError(`${name} must be >= ${String(min)}, got ${String(value)}`);
}
