import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import {
  addFabric,
  addToBill,
  choose,
  connectivity,
  payInFull,
  reviewAndSave,
  serverGet,
  signIn,
  startPurchase,
  waitForAppShell,
} from './helpers';

/** 1.5 m of the red organza at the POS, paid in cash. */
async function sellOneAndAHalf(page: Page) {
  await page.goto('/pos');
  await addToBill(page, 'أورجانزا', 'أحمر', '1.5');
  await payInFull(page);
  await expect(page).toHaveURL(/\/pos\/view\?id=/);
}

/** A new reference price on the fabric's page. */
async function reprice(page: Page, fabricId: string, rial: string) {
  await page.goto(`/inventory/fabric?id=${fabricId}`);
  await page.getByLabel('السعر المرجعي للمتر').fill(rial);
  await page.getByRole('button', { name: 'حفظ' }).click();
  await expect(connectivity(page)).toContainText(/معلّق/);
}

test('two devices offline: concurrent edits settle, a roll sold twice is flagged, both sync', async ({
  browser,
  request,
}) => {
  const desk: BrowserContext = await browser.newContext();
  const deskPage = await desk.newPage();
  await signIn(deskPage);
  await waitForAppShell(deskPage);
  await addFabric(deskPage, 'أورجانزا');
  const fabricId = new URL(deskPage.url()).searchParams.get('id') ?? '';
  // One ready piece of 2 m: there is not enough for two sales of 1.5 m.
  await startPurchase(deskPage, 'قطعة جاهزة', 'أورجانزا');
  await choose(deskPage, 'اللون', 'أحمر');
  await deskPage.getByLabel('طول القطعة').fill('2');
  await deskPage.getByLabel('سعر القطعة').fill('600');
  await reviewAndSave(deskPage);
  await expect(connectivity(deskPage)).not.toContainText(/معلّق/);

  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const phonePage = await phone.newPage();
  await signIn(phonePage);
  await waitForAppShell(phonePage);
  await phonePage.goto('/inventory');
  await expect(phonePage.getByRole('region', { name: 'أورجانزا' })).toBeVisible();

  // Airplane mode on both. Each sells 1.5 m of the same 2 m piece and reprices the fabric:
  // the desk first, the phone a moment later.
  await desk.setOffline(true);
  await phone.setOffline(true);
  await sellOneAndAHalf(deskPage);
  await sellOneAndAHalf(phonePage);
  await reprice(deskPage, fabricId, '420');
  await reprice(phonePage, fabricId, '440');

  // Back online, the desk first.
  await desk.setOffline(false);
  await expect(connectivity(deskPage)).not.toContainText(/معلّق/);
  await phone.setOffline(false);
  await expect(connectivity(phonePage)).not.toContainText(/معلّق/);

  // The later edit (the phone's) won on the server; the desk's is in the conflict log.
  await expect
    .poll(
      async () =>
        (await serverGet<{ refPricePerMeterCents: number }>(request, `/fabrics/${fabricId}`))
          .refPricePerMeterCents,
    )
    .toBe(2200);
  // Both sales are kept (never blocked): the roll is now 1 m short, flagged for review.
  await deskPage.getByRole('button', { name: 'زامن الآن' }).click();
  await deskPage.goto('/settings/sync');
  const review = deskPage.getByRole('region', { name: 'رولات تحتاج مراجعة' });
  await expect(review.getByRole('link', { name: /^R-[A-Z]+\d{4}$/ })).toBeVisible();
  await expect(review).toContainText('-1');
  const conflicts = deskPage.getByRole('region', { name: 'تعارضات حُسمت' });
  await expect(conflicts.getByRole('row', { name: /أورجانزا/ })).toHaveCount(1);
  // And the desk now shows the phone's price.
  await deskPage.goto(`/inventory/fabric?id=${fabricId}`);
  await expect(deskPage.getByLabel('السعر المرجعي للمتر')).toHaveValue('440');

  await desk.close();
  await phone.close();
});
