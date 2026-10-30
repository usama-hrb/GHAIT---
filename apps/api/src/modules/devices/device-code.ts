/** 1 → A, 26 → Z, 27 → AA, 28 → AB … (bijective base 26), the device's roll-code prefix. */
export function deviceCodeOf(n: number): string {
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`not a device number: ${String(n)}`);
  let code = '';
  for (let rest = n; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    code = String.fromCharCode(65 + ((rest - 1) % 26)) + code;
  }
  return code;
}
