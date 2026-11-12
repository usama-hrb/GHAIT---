import type { MoneyUnit } from '@fabric/core';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MoneyUnitProvider } from '@/shared/format';

/**
 * Shared by the tests of the screens. There is no DOM in the test environment, so a component is
 * rendered to static HTML and the tests read what a person would see in it.
 */

/** `node` as static HTML, with money shown in `unit` (the `money_display_unit` setting). */
export function markup(node: ReactNode, unit: MoneyUnit = 'rial'): string {
  return renderToStaticMarkup(<MoneyUnitProvider unit={unit}>{node}</MoneyUnitProvider>);
}

/** What a reader sees in `html`: no tags, entities decoded, one plain space between words. */
export function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** How many times `needle` occurs in `haystack`. */
export function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}
