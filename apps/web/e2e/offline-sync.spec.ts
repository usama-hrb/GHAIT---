import { type APIRequestContext, type BrowserContext, expect, test } from '@playwright/test';
import {
  addProduct,
  connectivity,
  serverGet,
  serverRecords,
  signIn,
  waitForAppShell,
} from './helpers';

const serverProducts = (request: APIRequestContext) =>
  serverGet<
    { id: string; name: string; pricePerMeterCents: number; minPricePerMeterCents: number }[]
  >(request, '/products');

test('a product with stock added offline reaches the server and a second device', async ({
  browser,
  request,
}) => {
  const desk: BrowserContext = await browser.newContext();
  const page = await desk.newPage();
  await signIn(page);
  await waitForAppShell(page);
  await page.goto('/inventory');
  const status = connectivity(page);
  await expect(status).toContainText('متصل');

  // Offline: add a product with its first stock (prices typed in rial), see it listed and waiting.
  await desk.setOffline(true);
  await expect(status).toContainText('دون اتصال');
  const productId = await addProduct(page, { name: 'روزا' });
  await page.getByRole('link', { name: 'العودة إلى المخزون' }).click();
  await expect(page.getByRole('row', { name: /روزا/ })).toContainText('متوفر');
  await expect(status).toContainText(/معلّق/);
  expect((await serverProducts(request)).map((product) => product.name)).not.toContain('روزا');

  // Online again: the outbox drains by itself and the server has the product (400 rial = 2000
  // cents, minimum 360 rial) and its batch (50 m for 16,000 rial).
  await desk.setOffline(false);
  await expect(status).not.toContainText(/معلّق/);
  await expect
    .poll(async () => (await serverProducts(request)).find((product) => product.id === productId))
    .toMatchObject({ pricePerMeterCents: 2000, minPricePerMeterCents: 1800 });
  await expect
    .poll(async () =>
      (
        await serverRecords<{
          productId: string;
          receivedQuantity: number;
          costTotalCents: number;
        }>(request, 'product_batch')
      )
        .filter((batch) => batch.productId === productId)
        .map((batch) => [batch.receivedQuantity, batch.costTotalCents]),
    )
    .toEqual([[5000, 80_000]]);

  // A second device (fresh browser, empty local database) pulls it after signing in.
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const phonePage = await phone.newPage();
  await signIn(phonePage);
  await phonePage.goto('/inventory');
  await expect(phonePage.getByRole('link', { name: /روزا/ })).toBeVisible();

  await desk.close();
  await phone.close();
});
