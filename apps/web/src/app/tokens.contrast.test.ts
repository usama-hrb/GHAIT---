import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * WCAG 2.1 contrast of the semantic token pairs in globals.css, both themes.
 * Text pairs >= 4.5:1, input borders and the focus ring >= 3:1 (non-text, WCAG 1.4.11).
 * If a pair fails, change the token only with the owner's approval; never lower a threshold.
 */

const TEXT = 4.5;
const NON_TEXT = 3;

const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

function declarations(selector: ':root' | '.dark'): Record<string, string> {
  const escaped = selector.replace('.', '\\.');
  const blocks = css.matchAll(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g'));
  const vars: Record<string, string> = {};
  for (const [, body = ''] of blocks) {
    for (const [, name = '', value = ''] of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
      vars[name] = value.trim();
    }
  }
  return vars;
}

const light = declarations(':root');
const themes = { light, dark: { ...light, ...declarations('.dark') } };

function resolve(vars: Record<string, string>, name: string, seen: string[] = []): string {
  const value = vars[name];
  if (value === undefined) throw new Error(`--${name} is not defined`);
  const reference = /^var\(--([\w-]+)\)$/.exec(value);
  if (!reference?.[1]) return value;
  if (seen.includes(name)) throw new Error(`cycle: ${[...seen, name].join(' → ')}`);
  return resolve(vars, reference[1], [...seen, name]);
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) throw new Error(`expected #RRGGBB, got ${hex}`);
  const channels = [0, 2, 4].map((offset) => {
    const c = Number.parseInt(match[1]?.slice(offset, offset + 2) ?? '', 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** [surface, content, minimum] */
const PAIRS: [string, string, number][] = [
  ['background', 'foreground', TEXT],
  ['card', 'card-foreground', TEXT],
  ['popover', 'popover-foreground', TEXT],
  ['primary', 'primary-foreground', TEXT],
  ['secondary', 'secondary-foreground', TEXT],
  ['muted', 'muted-foreground', TEXT],
  ['background', 'muted-foreground', TEXT],
  ['card', 'muted-foreground', TEXT],
  ['accent', 'accent-foreground', TEXT],
  ['destructive', 'destructive-foreground', TEXT],
  ['success', 'success-foreground', TEXT],
  ['warning', 'warning-foreground', TEXT],
  ['info', 'info-foreground', TEXT],
  ['sidebar', 'sidebar-foreground', TEXT],
  ['sidebar', 'sidebar-primary', TEXT],
  ['sidebar-primary', 'sidebar-primary-foreground', TEXT],
  ['sidebar-accent', 'sidebar-accent-foreground', TEXT],
  // Business colours used as text (text-profit, …) on page and card surfaces.
  ...['profit', 'loss', 'debt', 'capital', 'estimated'].flatMap(
    (tone): [string, string, number][] => [
      ['background', tone, TEXT],
      ['card', tone, TEXT],
    ],
  ),
  ['background', 'input', NON_TEXT],
  ['card', 'input', NON_TEXT],
  ['background', 'ring', NON_TEXT],
  ['card', 'ring', NON_TEXT],
  ['sidebar', 'sidebar-ring', NON_TEXT],
];

describe.each(Object.entries(themes))('%s theme contrast', (_theme, vars) => {
  it.each(PAIRS)('%s / %s >= %d:1', (surface, content, minimum) => {
    const ratio = contrast(resolve(vars, surface), resolve(vars, content));
    expect(ratio, `${surface} vs ${content}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      minimum,
    );
  });
});

describe('contrast helper', () => {
  it('matches WCAG reference values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
});
