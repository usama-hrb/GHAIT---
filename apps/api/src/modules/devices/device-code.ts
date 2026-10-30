/** 1 → A, 26 → Z, 27 → AA, 28 → AB … (bijective base 26), the device's roll-code prefix. */
export function deviceCodeOf(n: number): string {
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`not a device number: ${String(n)}`);
  let code = '';
  for (let rest = n; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    code = String.fromCharCode(65 + ((rest - 1) % 26)) + code;
  }
  return code;
}

/** A → 1, Z → 26, AA → 27 (the inverse of deviceCodeOf). */
export function deviceNumberOf(code: string): number {
  if (!/^[A-Z]{1,3}$/.test(code)) throw new RangeError(`not a device code: ${code}`);
  let n = 0;
  for (const letter of code) n = n * 26 + (letter.charCodeAt(0) - 64);
  return n;
}
