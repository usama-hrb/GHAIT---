import { writeFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { ar } from '../src/i18n/ar';
import { en } from '../src/i18n/en';
import type { Finding, Language, Size } from './responsive-kit';

/**
 * The workbench of one audit test, shared by the audits that open one feature in depth
 * (`responsive.integrity.spec.ts`, `responsive.zakat.spec.ts`): where the test is, what it found,
 * what failed and what it noted, and the way the findings reach the report file. The measurement
 * itself is `measure()` in `responsive-kit.ts`.
 */

export type Catalog = typeof en;
export const catalogs: Record<Language, Catalog> = { en, ar };

export interface Result {
  findings: Finding[];
  scrollRegions: string[];
  /** What was measured that is not a failure: sizes, scroll lengths, contrast, states. */
  notes: string[];
}

/** One test's workbench: where it is, what it found, and what failed. */
export interface Run {
  /** The audit that owns the run; it names the report file. */
  feature: string;
  page: Page;
  m: Catalog;
  size: Size;
  language: Language;
  /** The report's key: the size, the language and what is being opened. */
  key: string;
  result: Result;
  problems: string[];
}

const report: Record<string, Result> = {};

export function expectThat(run: Run, ok: boolean, what: string): void {
  if (!ok) run.problems.push(`${run.key} ${what}`);
}

export function note(run: Run, text: string): void {
  run.result.notes.push(text);
}

/** Takes a page measurement into the report; the failures that matter are also problems. */
export function take(
  run: Run,
  name: string,
  measured: { findings: Finding[]; scrollRegions: string[] },
): void {
  for (const finding of measured.findings) {
    run.result.findings.push({ ...finding, where: `${name}: ${finding.where}` });
    if (
      finding.kind === 'doc-overflow' ||
      finding.kind === 'offscreen' ||
      finding.kind === 'tiny-target'
    ) {
      run.problems.push(`${run.key} ${name} ${finding.kind} ${finding.where} ${finding.detail}`);
    }
  }
  for (const region of measured.scrollRegions) {
    run.result.scrollRegions.push(`${name}: ${region}`);
  }
}

export function contextOf(size: Size, blockWorkers = false) {
  return {
    viewport: { width: size.width, height: size.height },
    isMobile: size.touch,
    hasTouch: size.touch,
    deviceScaleFactor: size.touch ? 2 : 1,
    // A page route sees a request only when no service worker answers it first.
    serviceWorkers: blockWorkers ? ('block' as const) : ('allow' as const),
  };
}

/** `RESPONSIVE_SIZES=a,b` and `RESPONSIVE_LANGS=en,ar` narrow a run; nothing set means everything. */
export function isWanted(size: Size, language: Language): boolean {
  const sizes = (process.env.RESPONSIVE_SIZES ?? '').split(',').filter(Boolean);
  const languages = (process.env.RESPONSIVE_LANGS ?? '').split(',').filter(Boolean);
  return (
    (sizes.length === 0 || sizes.includes(size.name)) &&
    (languages.length === 0 || languages.includes(language))
  );
}

/** A fresh device of this size, ready to be measured. */
export function startRun(
  feature: string,
  page: Page,
  size: Size,
  language: Language,
  answer: string,
): Run {
  const key = `${size.name}/${language} ${answer}`;
  const result: Result = { findings: [], scrollRegions: [], notes: [] };
  report[key] = result;
  return { feature, page, m: catalogs[language], size, language, key, result, problems: [] };
}

/** Writes the run's report when `RESPONSIVE_REPORT` asks for one, and fails on its problems. */
export function finish(run: Run): void {
  if (process.env.RESPONSIVE_REPORT) {
    const mine = Object.fromEntries(Object.entries(report).filter(([name]) => name === run.key));
    const file = `${process.env.RESPONSIVE_REPORT}.${run.feature}.${run.key.replace(/[/ ]/g, '.')}.json`;
    writeFileSync(file, JSON.stringify({ ...mine, problems: run.problems }, null, 1));
  }
  if (!process.env.RESPONSIVE_SOFT) expect(run.problems).toEqual([]);
}
