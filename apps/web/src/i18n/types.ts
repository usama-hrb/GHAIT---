import type { ar } from './ar';

/** A catalog's shape with every text widened to a string, so each language can fill it in. */
type Widen<T> = T extends string
  ? string
  : T extends (...args: infer Args) => infer Result
    ? (...args: Args) => Widen<Result>
    : T extends object
      ? { -readonly [Key in keyof T]: Widen<T[Key]> }
      : T;

/**
 * Every text of the app. Arabic (ar.ts) is the reference; English (en.ts) must have the same keys,
 * and the compiler refuses a missing or extra one.
 */
export type Messages = Widen<typeof ar>;
