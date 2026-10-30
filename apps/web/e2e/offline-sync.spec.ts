import { type APIRequestContext, type BrowserContext, expect, test } from '@playwright/test';
import { connectivity, serverGet, signIn, waitForAppShell } from './helpers';

const serverFabrics = (request: APIRequestContext) =>
  serverGet<{ name: string; refPricePerMeterCents: number }[]>(request, '/fabrics');

test('a fabric added offline reaches the server and a second device', async ({
  browser,
  request,
}) => {
  const desk: BrowserContext = await browser.newContext();
  const page = await desk.newPage();
  await signIn(page);
  await waitForAppShell(page);
  const status = connectivity(page);
  await expect(status).toContainText('متصل');

  // Offline: navigate, add a fabric (prices typed in rial), see it listed and waiting.
  await desk.setOffline(true);
  await expect(status).toContainText('دون اتصال');
  // The header's button (the empty state offers the same link).
  await page.getByRole('link', { name: 'قماش جديد' }).first().click();
  await expect(page.getByLabel('اسم القماش')).toBeVisible();
  await page.getByLabel('اسم القماش').fill('روزا');
  await page.getByLabel('السعر المرجعي للمتر').fill('400');
  await page.getByLabel('أقل سعر للمتر').fill('360');
  await page.getByRole('button', { name: 'حفظ' }).click();
  await expect(page).toHaveURL(/\/inventory\/fabric\?id=/);
  await page.getByRole('link', { name: 'العودة إلى الأقمشة' }).click();
  await expect(page.getByRole('link', { name: 'روزا' })).toBeVisible();
  await expect(status).toContainText('عملية معلّقة واحدة');
  expect((await serverFabrics(request)).map((fabric) => fabric.name)).not.toContain('روزا');

  // Online again: the outbox drains by itself and the server has it (400 rial = 2000 cents).
  await desk.setOffline(false);
  await expect(status).not.toContainText(/معلّق/);
  await expect
    .poll(async () => (await serverFabrics(request)).find((fabric) => fabric.name === 'روزا'))
    .toMatchObject({ refPricePerMeterCents: 2000 });

  // A second device (fresh browser, empty local database) pulls it after signing in.
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const phonePage = await phone.newPage();
  await signIn(phonePage);
  await expect(phonePage.getByRole('link', { name: 'روزا' })).toBeVisible();

  await desk.close();
  await phone.close();
});
