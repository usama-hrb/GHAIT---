import { normalizeDigits } from '@fabric/core';

// Harakat, superscript alef and tatweel: ignored when searching.
const IGNORED = /[ً-ٰٟـ]/g;

/**
 * Text as compared by search boxes: case and diacritics ignored, and the letters people type
 * interchangeably treated as one (أ إ آ ٱ → ا, ى → ي, ة → ه, ؤ → و, ئ → ي), digits Western.
 */
export function normalizeForSearch(text: string): string {
  return normalizeDigits(text)
    .toLowerCase()
    .replace(IGNORED, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every word of `query` appears in one of `fields` (normalised). */
export function matchesSearch(
  query: string,
  fields: readonly (string | null | undefined)[],
): boolean {
  const words = normalizeForSearch(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalizeForSearch(fields.filter(Boolean).join(' '));
  return words.every((word) => haystack.includes(word));
}
