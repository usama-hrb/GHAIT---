const rules = new Intl.PluralRules('ar');

export type PluralForms = Record<Intl.LDMLPluralRule, string>;

/** Picks the Arabic plural form for `count` (zero, one, two, few: 3–10, many: 11–99, other). */
export function plural(count: number, forms: PluralForms): string {
  return forms[rules.select(count)];
}
