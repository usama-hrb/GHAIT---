import { getLanguage } from './store';
import type { Language } from './languages';

/**
 * The forms of a counted noun. `other` is required; a language uses the forms its rules have
 * (English: one, other; Arabic: zero, one, two, few, many, other). `zero` is also used for a
 * count of 0 in any language, for "no sales yet".
 */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

const rules = new Map<Language, Intl.PluralRules>();

function rulesFor(language: Language): Intl.PluralRules {
  let found = rules.get(language);
  if (!found) {
    found = new Intl.PluralRules(language);
    rules.set(language, found);
  }
  return found;
}

/** Picks the form for `count` in the language shown (or `language`). */
export function plural(
  count: number,
  forms: PluralForms,
  language: Language = getLanguage(),
): string {
  if (count === 0 && forms.zero !== undefined) return forms.zero;
  return forms[rulesFor(language).select(count)] ?? forms.other;
}

/** `plural` fixed to one language: a catalog counts in its own language whatever is showing. */
export const pluralFor =
  (language: Language) =>
  (count: number, forms: PluralForms): string =>
    plural(count, forms, language);
