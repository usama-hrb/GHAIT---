import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import {
  addProduct,
  addToBill,
  connectivity,
  payInFull,
  serverGet,
  signIn,
  waitForAppShell,
} from './helpers';

/** 1.5 m of the red organza at the POS, paid in cash. */
async function sellOneAndAHalf(page: Page) {
  await page.goto('/pos');
  await addToBill(page, 'أورجانزا - أحمر', '1.5');
  await payInFull(page);
}

/** A new normal price on the product's page, through its Edit dialog. */
async function reprice(page: Page, productId: string, rial: string) {
  await page.goto(`/inventory/product?id=${productId}`);
  await page.getByRole('button', { name: 'تعديل المنتج' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/سعر البيع العادي/).fill(rial);
  await dialog.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(connectivity(page)).toContainText(/معلّق/);
}

test('two devices offline: concurrent edits settle, a batch sold twice is flagged, both sync', async ({
  browser,
  request,
}) => {
  const desk: BrowserContext = await browser.newContext();
  const deskPage = await desk.newPage();
  await signIn(deskPage);
  await waitForAppShell(deskPage);
  // One ready piece of 2 m: there is not enough for two sales of 1.5 m.
  const productId = await addProduct(deskPage, {
    name: 'أورجانزا - أحمر',
    stock: { quantity: '2', cost: '300' },
  });
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
  await expect(phonePage.getByRole('link', { name: /أورجانزا - أحمر/ })).toBeVisible();

  // Airplane mode on both. Each sells 1.5 m of the same 2 m piece and reprices the product:
  // the desk first, the phone a moment later.
  await desk.setOffline(true);
  await phone.setOffline(true);
  await sellOneAndAHalf(deskPage);
  await sellOneAndAHalf(phonePage);
  await reprice(deskPage, productId, '420');
  await reprice(phonePage, productId, '440');

  // Back online, the desk first.
  await desk.setOffline(false);
  await expect(connectivity(deskPage)).not.toContainText(/معلّق/);
  await phone.setOffline(false);
  await expect(connectivity(phonePage)).not.toContainText(/معلّق/);

  // The later edit (the phone's) won on the server; the desk's is in the conflict log.
  await expect
    .poll(
      async () =>
        (await serverGet<{ pricePerMeterCents: number }>(request, `/products/${productId}`))
          .pricePerMeterCents,
    )
    .toBe(2200);
  // Both sales are kept (never blocked): the batch is now 1 m short, flagged for review.
  await deskPage.getByRole('button', { name: 'زامن الآن' }).click();
  await deskPage.goto('/settings/sync');
  const review = deskPage.getByRole('region', { name: 'دفعات تحتاج مراجعة' });
  await expect(review.getByRole('link', { name: /^[RB]-[A-Z]+\d{4}$/ })).toBeVisible();
  await expect(review).toContainText('-1');
  const conflicts = deskPage.getByRole('region', { name: 'تعارضات حُسمت' });
  await expect(conflicts.getByRole('row', { name: /أورجانزا/ })).toHaveCount(1);
  // And the desk now shows the phone's price.
  await deskPage.goto(`/inventory/product?id=${productId}`);
  await deskPage.getByRole('button', { name: 'تعديل المنتج' }).click();
  await expect(deskPage.getByRole('dialog').getByLabel(/سعر البيع العادي/)).toHaveValue('440');

  await desk.close();
  await phone.close();
});
