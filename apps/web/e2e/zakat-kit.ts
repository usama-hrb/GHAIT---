import { expect, type Page } from '@playwright/test';
import { ar } from '../src/i18n/ar';
import { daysAgo } from './helpers';

/**
 * What the zakat specs share: `zakat.spec.ts` (the flow), `responsive.zakat.spec.ts` (its layout)
 * and `responsive.spec.ts` (a report to open). The words come from the Arabic catalog, so a
 * rewording of a screen cannot make a spec lie about it.
 */

const t = ar.zakat;

/** The seven steps of the review, in order. */
export const STEPS = [
  'settings',
  'base',
  'inventory',
  'nisab',
  'hawl',
  'result',
  'confirm',
] as const;
export type Step = (typeof STEPS)[number];

/**
 * Reads the review the way a person does, one step at a time, down to the last one. A step that is
 * named in `blocked` must say it cannot be worked out yet.
 */
export async function walkToConfirm(page: Page, blocked: readonly Step[] = []): Promise<void> {
  for (const [index, step] of STEPS.entries()) {
    await expect(page.getByText(t.review.stepOf(index + 1, STEPS.length))).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 3, name: t.review.steps[step], exact: true }),
    ).toBeVisible();
    if (blocked.includes(step)) await expect(page.getByText(t.review.blockedTitle)).toBeVisible();
    if (index < STEPS.length - 1) await page.getByRole('button', { name: t.review.next }).click();
  }
}

/** What the confirmation asks for: the figures were read, and so were the items marked for review. */
export async function confirmReading(page: Page): Promise<void> {
  const boxes = page.getByRole('checkbox');
  await expect(boxes.first()).toBeVisible();
  for (let index = 0; index < (await boxes.count()); index += 1) await boxes.nth(index).check();
}

/** The id of the report whose page is open. */
export function reportIdOf(page: Page): string {
  return new URL(page.url()).searchParams.get('id') ?? '';
}

/** The methodology of a shop whose first hawl began 400 days ago, with gold at 1 rial a gram. */
export async function configureZakat(page: Page): Promise<void> {
  await page.goto('/zakat/settings');
  await page.getByLabel(t.fields.hawlStart).fill(daysAgo(400));
  await page.getByLabel(t.fields.goldPrice, { exact: true }).fill('1');
  await page.getByLabel(`${t.fields.goldPrice}: ${t.fields.priceDate}`).fill(daysAgo(1));
  await page.getByRole('button', { name: t.settings.save }).click();
  await expect(page.getByText(t.settings.saved)).toBeVisible();
}

/** Reads the review to its end and confirms it: that is what saves a report, on this device. */
export async function saveReport(page: Page): Promise<void> {
  await page.goto('/zakat/review');
  await walkToConfirm(page);
  await confirmReading(page);
  await page.getByRole('button', { name: t.confirm.save }).click();
  await expect(page).toHaveURL(/\/zakat\/view\/?\?id=/);
}
