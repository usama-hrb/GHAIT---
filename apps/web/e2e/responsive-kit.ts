import { expect, type Page } from '@playwright/test';
import { setDeviceLanguage } from './helpers';
import { E2E } from './stack';

/**
 * What the responsive audit specs share (`responsive.spec.ts`: every route; `responsive.workflows.spec.ts`:
 * the dialogs and drawers each page opens; `responsive.integrity.spec.ts` and `responsive.zakat.spec.ts`:
 * one feature in depth): the screen sizes, the in-page measurement, the contrast reader, the sign-in.
 * The measurement runs in the browser and reports, with no screenshot, what a person would see
 * wrong: the page scrolling sideways, a control off-screen or clipped, a control too small to hit,
 * a piece of text too faint against its background.
 */

export interface Size {
  name: string;
  width: number;
  height: number;
  /** A touch screen: its pointer is coarse, so the `pointer-coarse:` sizes apply. */
  touch: boolean;
}

export const SIZES: readonly Size[] = [
  { name: 'phone-320', width: 320, height: 720, touch: true },
  { name: 'phone-375', width: 375, height: 812, touch: true },
  { name: 'phone-390', width: 390, height: 844, touch: true },
  { name: 'phone-430', width: 430, height: 932, touch: true },
  { name: 'tablet-portrait', width: 800, height: 1280, touch: true },
  { name: 'tablet-landscape', width: 1280, height: 800, touch: true },
  { name: 'desktop', width: 1440, height: 900, touch: false },
];

export type Language = 'ar' | 'en';
export const LANGUAGES: readonly Language[] = ['en', 'ar'];

export interface Finding {
  kind: 'doc-overflow' | 'offscreen' | 'clipped' | 'tiny-target' | 'small-target' | 'tiny-text';
  where: string;
  detail: string;
}

export interface Measured {
  findings: Finding[];
  /** Deliberate sideways scroll regions, for the audit's review (a table that should be cards?). */
  scrollRegions: string[];
}

/** Runs in the page. Self-contained: it is serialised. */
export function measure(touch: boolean): Measured {
  const findings: Finding[] = [];
  const scrollRegions: string[] = [];
  const doc = document.documentElement;
  const vw = doc.clientWidth;

  const label = (el: Element): string => {
    const parts: string[] = [];
    let current: Element | null = el;
    for (let depth = 0; depth < 4 && current && current !== document.body; depth += 1) {
      const testId = current.getAttribute('data-testid');
      const role = current.getAttribute('role');
      const classes =
        typeof current.className === 'string'
          ? current.className
              .split(/\s+/)
              .filter((c) => c !== '' && !/[:[\]/()]/.test(c))
              .slice(0, 2)
              .map((c) => `.${c}`)
              .join('')
          : '';
      parts.unshift(
        `${current.tagName.toLowerCase()}${current.id ? `#${current.id}` : ''}${classes}${
          testId ? `[${testId}]` : role ? `[role=${role}]` : ''
        }`,
      );
      current = current.parentElement;
    }
    return parts.join('>');
  };
  const text = (el: Element): string =>
    (el.getAttribute('aria-label') ?? el.textContent).replace(/\s+/g, ' ').trim().slice(0, 40);

  const sideways = (value: string) => /^(auto|scroll)$/.test(value);
  const clips = (value: string) => /^(hidden|clip|auto|scroll)$/.test(value);
  const visible = (el: Element, rect: DOMRect, style: CSSStyleDeclaration) =>
    rect.width > 0 &&
    rect.height > 0 &&
    style.visibility !== 'hidden' &&
    style.display !== 'none' &&
    Number(style.opacity) > 0;
  /** The first ancestor that clips or scrolls sideways. */
  const clipper = (el: Element): HTMLElement | null => {
    let parent = el.parentElement;
    while (parent && parent !== document.body) {
      if (clips(getComputedStyle(parent).overflowX)) return parent;
      parent = parent.parentElement;
    }
    return null;
  };
  /** Part of a screen-reader-only or hidden-by-clip wrapper: not seen, not touched. */
  const unseen = (el: Element): boolean =>
    el.closest('.sr-only, [aria-hidden="true"], [hidden], [inert]') !== null;

  const overflow = Math.max(doc.scrollWidth, document.body.scrollWidth) - vw;
  if (overflow > 1) {
    findings.push({
      kind: 'doc-overflow',
      where: 'document',
      detail: `${String(overflow)}px wider than ${String(vw)}px`,
    });
  }

  const seenRegions = new Set<Element>();
  for (const el of document.body.querySelectorAll('*')) {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (!visible(el, rect, style) || unseen(el)) continue;

    if (rect.right > vw + 1 || rect.left < -1) {
      const holder = clipper(el);
      if (holder === null) {
        findings.push({
          kind: 'offscreen',
          where: label(el),
          detail: `${String(Math.round(rect.left))}…${String(Math.round(rect.right))} of ${String(vw)} "${text(el)}"`,
        });
      } else if (!seenRegions.has(holder) && sideways(getComputedStyle(holder).overflowX)) {
        seenRegions.add(holder);
      }
    }

    // Content cut off by a box that hides its overflow (a label that is not truncated on purpose).
    const html = el as HTMLElement;
    if (
      clips(style.overflowX) &&
      !sideways(style.overflowX) &&
      style.textOverflow !== 'ellipsis' &&
      html.scrollWidth > html.clientWidth + 1 &&
      html.clientWidth > 3 &&
      el.tagName !== 'svg' &&
      // A field scrolls its own text when the value is longer than the box.
      !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) &&
      el.closest('svg, [data-slot="chart"], img, picture, [data-slot="avatar"]') === null &&
      !el.querySelector('.truncate, [class*="line-clamp"], img')
    ) {
      findings.push({
        kind: 'clipped',
        where: label(el),
        detail: `${String(html.scrollWidth)}px of content in ${String(html.clientWidth)}px "${text(el)}"`,
      });
    }

    if (sideways(style.overflowX) && html.scrollWidth > html.clientWidth + 1) {
      seenRegions.add(el);
    }
  }
  for (const region of seenRegions) {
    const html = region as HTMLElement;
    scrollRegions.push(
      `${label(region)} ${String(html.scrollWidth)}px in ${String(html.clientWidth)}px`,
    );
  }

  // Controls: a touch screen needs a target it can hit (44px asked for; 40px is accepted inside a
  // field; under 32px is a failure).
  const controls = document.body.querySelectorAll(
    'a[href], button, select, textarea, summary, input:not([type="hidden"]), [role="button"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="radio"], [role="combobox"], [role="option"]',
  );
  const seenTargets = new Set<string>();
  const accepted = touch ? 40 : 24;
  const failing = touch ? 32 : 20;
  for (const el of controls) {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (!visible(el, rect, style) || unseen(el)) continue;
    if ((el as HTMLInputElement).disabled) continue;
    // A link inside a sentence is exempt.
    if (style.display === 'inline' && el.closest('p, li, td, dd, span, label') !== null) continue;
    let width = rect.width;
    let height = rect.height;
    // The label around a control, and the invisible hit area some controls extend (::after), are
    // part of what a finger can hit.
    const labelled = el.closest('label');
    if (labelled) {
      const labelRect = labelled.getBoundingClientRect();
      width = Math.max(width, labelRect.width);
      height = Math.max(height, labelRect.height);
    }
    const reach = getComputedStyle(el, '::after');
    if (reach.position === 'absolute') {
      width = Math.max(width, Number.parseFloat(reach.width) || 0);
      height = Math.max(height, Number.parseFloat(reach.height) || 0);
    }
    const side = Math.min(width, height);
    if (side + 0.5 < accepted && (el as HTMLInputElement).type !== 'file') {
      const key = `${label(el)}|${String(Math.round(width))}x${String(Math.round(height))}`;
      if (seenTargets.has(key)) continue;
      seenTargets.add(key);
      findings.push({
        kind: side < failing ? 'tiny-target' : 'small-target',
        where: label(el),
        detail: `${String(Math.round(width))}×${String(Math.round(height))} "${text(el)}"`,
      });
    }
  }

  // Text smaller than 11px is not read on a phone.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const smallText = new Set<string>();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || (node.textContent ?? '').trim() === '') continue;
    const style = getComputedStyle(parent);
    if (!visible(parent, parent.getBoundingClientRect(), style) || unseen(parent)) continue;
    const size = Number.parseFloat(style.fontSize);
    if (size < 11 && smallText.size < 20) smallText.add(`${label(parent)} ${String(size)}px`);
  }
  for (const entry of smallText) findings.push({ kind: 'tiny-text', where: entry, detail: '' });

  return { findings, scrollRegions };
}

export async function login(page: Page, language: Language): Promise<void> {
  await setDeviceLanguage(page, language);
  await page.goto('/login');
  await page.locator('input[autocomplete="username"]').fill(E2E.owner.username);
  await page.locator('input[autocomplete="current-password"]').fill(E2E.owner.password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/home$/);
  // A fresh device has nothing until the first pull has brought the shop's records.
  await page.goto('/inventory');
  await expect
    .poll(() => page.locator('a[href^="/inventory/product"]').count(), { timeout: 45_000 })
    .toBeGreaterThan(0);
  await page.waitForTimeout(2500);
}

/** The page has drawn what it shows: the shell is up and nothing is still a loading skeleton. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page
    .locator('#content, main')
    .first()
    .waitFor({ state: 'attached', timeout: 15_000 })
    .catch(() => undefined);
  await expect
    .poll(() => page.locator('[data-slot="skeleton"], [aria-busy="true"]').count(), {
      timeout: 8000,
    })
    .toBe(0)
    .catch(() => undefined);
  await page.waitForTimeout(350);
}

/** A piece of text that is too faint against what is behind it. */
export interface Weak {
  where: string;
  text: string;
  ratio: number;
  need: number;
  fg: string;
  bg: string;
}

/**
 * Runs in the page: the text inside `scopes` whose contrast with its background is below what
 * WCAG asks (4.5, or 3 for large text). The browser's own canvas turns any CSS colour (oklch
 * included) into pixels, and each ancestor's background is painted over the one before it, so
 * translucent surfaces are blended as they are on screen.
 */
export function contrastOf(scopes: string[]): Weak[] {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  const paint = (css: string) => {
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
  };
  const read = (): [number, number, number] => {
    const data = ctx.getImageData(0, 0, 1, 1).data;
    return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
  };
  const luminance = ([r, g, b]: [number, number, number]): number => {
    const linear = (value: number) => {
      const s = value / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  };
  const backgroundOf = (el: Element): [number, number, number] => {
    const chain: Element[] = [];
    for (let node: Element | null = el; node; node = node.parentElement) chain.unshift(node);
    paint('#ffffff');
    for (const node of chain) {
      const background = getComputedStyle(node).backgroundColor;
      if (background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') paint(background);
    }
    return read();
  };
  const colourOf = (
    el: Element,
    background: [number, number, number],
  ): [number, number, number] => {
    paint(`rgb(${background.join(',')})`);
    paint(getComputedStyle(el).color);
    const [r, g, b] = read();
    let opacity = 1;
    for (let node: Element | null = el; node; node = node.parentElement) {
      opacity *= Number(getComputedStyle(node).opacity);
    }
    return opacity < 1
      ? [
          background[0] * (1 - opacity) + r * opacity,
          background[1] * (1 - opacity) + g * opacity,
          background[2] * (1 - opacity) + b * opacity,
        ]
      : [r, g, b];
  };
  const named = (el: Element): string => {
    const classes =
      typeof el.className === 'string'
        ? el.className
            .split(/\s+/)
            .filter((c) => c !== '' && !/[:[\]/()]/.test(c))
            .slice(0, 2)
            .map((c) => `.${c}`)
            .join('')
        : '';
    return `${el.parentElement?.tagName.toLowerCase() ?? ''}>${el.tagName.toLowerCase()}${classes}`;
  };

  const weak: Weak[] = [];
  const seen = new Set<string>();
  for (const scope of scopes) {
    for (const root of document.querySelectorAll(scope)) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (!parent || text === '') continue;
        const box = parent.getBoundingClientRect();
        const style = getComputedStyle(parent);
        if (
          box.width === 0 ||
          box.height === 0 ||
          style.visibility === 'hidden' ||
          style.display === 'none' ||
          parent.closest(
            '.sr-only, [hidden], [inert], svg, button:disabled, [aria-disabled="true"], [data-disabled]',
          ) !== null
        ) {
          continue;
        }
        const background = backgroundOf(parent);
        const colour = colourOf(parent, background);
        const ratio = (luminance(colour) + 0.05) / (luminance(background) + 0.05);
        const hi = Math.max(ratio, 1 / ratio);
        const size = Number.parseFloat(style.fontSize);
        const bold = Number.parseInt(style.fontWeight, 10) >= 700;
        const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
        if (hi + 0.005 >= need) continue;
        const key = `${named(parent)}|${style.color}|${background.join(',')}`;
        if (seen.has(key) || weak.length >= 30) continue;
        seen.add(key);
        weak.push({
          where: named(parent),
          text: text.slice(0, 32),
          ratio: Math.round(hi * 100) / 100,
          need,
          fg: style.color,
          bg: `rgb(${background.join(', ')})`,
        });
      }
    }
  }
  return weak;
}
