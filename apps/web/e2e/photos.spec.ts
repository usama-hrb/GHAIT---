import path from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  addFabric,
  connectivity,
  reviewAndSave,
  serverRecords,
  signIn,
  startPurchase,
} from './helpers';

// The brand folder's sample: a 2048 x 2048 JPEG of 2.2 MB.
const PRODUCT = path.join(import.meta.dirname, '../public/brand/product_1.jpeg');

interface ServerPhoto {
  variantId: string;
  width: number;
  height: number;
  byteLength: number;
  data: string;
  voidedAt: string | null;
}

/** Opens a colour's dialog on the fabric page, as `act` changes it, and saves. */
async function editColor(page: Page, color: string, act: (dialog: Locator) => Promise<void>) {
  await page.getByRole('button', { name: `تعديل اللون: ${color}` }).click();
  const dialog = page.getByRole('dialog');
  await act(dialog);
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog).toBeHidden();
}

const choosePhoto = async (dialog: Locator) => {
  await dialog.getByLabel('اختر صورة').setInputFiles(PRODUCT);
  // Saving waits for the picture to be made small, so the dialog shows it before the save.
  await expect(dialog.locator('img')).toBeVisible();
};

test('a colour gets a photo: made small on the device, saved offline, synced, shown at the till, replaced and removed', async ({
  browser,
  request,
}) => {
  test.setTimeout(150_000);
  const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await desk.newPage();
  await signIn(page);
  await addFabric(page, 'ليبارد');
  const fabricPage = page.url();
  const red = page.getByRole('listitem').filter({ hasText: 'أحمر' });
  const blue = page.getByRole('listitem').filter({ hasText: 'أزرق' });

  // The 2.2 MB file is shown at once and saved as a small JPEG (480 px at most).
  await editColor(page, 'أحمر', choosePhoto);
  const thumb = red.locator('img');
  await expect(thumb).toBeVisible();
  const source = (await thumb.getAttribute('src')) ?? '';
  expect(source.startsWith('data:image/jpeg;base64,/9j/')).toBe(true);
  expect(source.length).toBeLessThan(180_000);
  expect(
    await thumb.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]),
  ).toEqual([480, 480]);

  // Offline, the other colour gets one too; it waits in the outbox and goes up when back online.
  await desk.setOffline(true);
  await editColor(page, 'أزرق', choosePhoto);
  await expect(blue.locator('img')).toBeVisible();
  await expect(connectivity(page)).toContainText(/معلّق/);
  await desk.setOffline(false);
  await expect(connectivity(page)).not.toContainText(/معلّق/);

  await expect
    .poll(async () => (await serverRecords<ServerPhoto>(request, 'photo')).length)
    .toBe(2);
  for (const photo of await serverRecords<ServerPhoto>(request, 'photo')) {
    expect(photo.width).toBeLessThanOrEqual(480);
    expect(photo.byteLength).toBeLessThan(120_000);
    expect(photo.data.startsWith('/9j/')).toBe(true);
  }

  // At the till: a tile with the photo for each colour that has cloth.
  await startPurchase(page, 'بالمتر', 'ليبارد');
  await page.getByLabel('سعر المتر').fill('320');
  await page.getByRole('button', { name: 'كل الألوان' }).click();
  await reviewAndSave(page);
  await page.goto('/pos');
  const tile = page.getByRole('button', { name: /أحمر\s+ليبارد/ });
  await expect(tile.locator('img')).toBeVisible();
  await expect(page.getByRole('button', { name: /أزرق\s+ليبارد/ }).locator('img')).toBeVisible();

  // Another device pulls the photos with the rest of the shop.
  const second = await (
    await browser.newContext({ viewport: { width: 1024, height: 768 } })
  ).newPage();
  await signIn(second);
  await second.goto('/pos');
  await expect(
    second.getByRole('button', { name: /أحمر\s+ليبارد/ }).locator('img'),
  ).toHaveAttribute('src', /^data:image\/jpeg;base64,\/9j\//);

  // A new photo replaces the old one (which stays, voided); then the colour has none.
  await page.goto(fabricPage);
  await editColor(page, 'أحمر', choosePhoto);
  await expect
    .poll(async () => {
      const photos = await serverRecords<ServerPhoto>(request, 'photo');
      return [photos.length, photos.filter((photo) => photo.voidedAt === null).length];
    })
    .toEqual([3, 2]);
  await editColor(page, 'أحمر', (dialog) =>
    dialog.getByRole('button', { name: 'احذف الصورة' }).click(),
  );
  await expect(red.locator('img')).toHaveCount(0);
  await expect
    .poll(async () => {
      const photos = await serverRecords<ServerPhoto>(request, 'photo');
      return photos.filter((photo) => photo.voidedAt === null).length;
    })
    .toBe(1);
  await page.goto('/pos');
  await expect(tile).toBeVisible();
  await expect(tile.locator('img')).toHaveCount(0);
});
