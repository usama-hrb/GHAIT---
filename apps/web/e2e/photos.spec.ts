import path from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { addProduct, connectivity, serverRecords, signIn } from './helpers';

// The brand folder's sample: a 2048 x 2048 JPEG of 2.2 MB.
const PICTURE = path.join(import.meta.dirname, '../public/brand/product_1.jpeg');

interface ServerPhoto {
  productId: string;
  width: number;
  height: number;
  byteLength: number;
  data: string;
  voidedAt: string | null;
}

/** Opens the product's Edit dialog on its page, as `act` changes it, and saves. */
async function editProduct(page: Page, act: (dialog: Locator) => Promise<void>) {
  await page.getByRole('button', { name: 'تعديل المنتج' }).click();
  const dialog = page.getByRole('dialog');
  await act(dialog);
  await dialog.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(dialog).toBeHidden();
}

const choosePicture = async (dialog: Locator) => {
  await dialog.getByLabel('اختر صورة').setInputFiles(PICTURE);
  // Saving waits for the picture to be made small, so the dialog shows it before the save.
  await expect(dialog.locator('img')).toBeVisible();
};

test('a product gets a photo: made small on the device, saved offline, synced, shown at the till, replaced and removed', async ({
  browser,
  request,
}) => {
  test.setTimeout(150_000);
  const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await desk.newPage();
  await signIn(page);

  // The 2.2 MB file is shown at once and saved as a small JPEG (480 px at most).
  const red = await addProduct(page, { name: 'ليبارد - أحمر', photo: PICTURE });
  const redPage = page.url();
  const thumb = page.locator('img[src^="data:image/jpeg"]').first();
  await expect(thumb).toBeVisible();
  const source = (await thumb.getAttribute('src')) ?? '';
  expect(source.startsWith('data:image/jpeg;base64,/9j/')).toBe(true);
  expect(source.length).toBeLessThan(180_000);
  expect(
    await thumb.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]),
  ).toEqual([480, 480]);

  // Offline, the other product gets one too; it waits in the outbox and goes up when back online.
  await desk.setOffline(true);
  await addProduct(page, { name: 'ليبارد - أزرق', photo: PICTURE });
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

  // In the inventory list and at the till: a tile with the photo for each product that has cloth.
  await page.goto('/inventory');
  await expect(page.getByRole('row', { name: /ليبارد - أحمر/ }).locator('img')).toBeVisible();
  await page.goto('/pos');
  const tile = page.getByRole('button', { name: /ليبارد - أحمر/ });
  await expect(tile.locator('img')).toBeVisible();
  await expect(page.getByRole('button', { name: /ليبارد - أزرق/ }).locator('img')).toBeVisible();

  // Another device pulls the photos with the rest of the shop.
  const second = await (
    await browser.newContext({ viewport: { width: 1024, height: 768 } })
  ).newPage();
  await signIn(second);
  await second.goto('/pos');
  await expect(
    second.getByRole('button', { name: /ليبارد - أحمر/ }).locator('img'),
  ).toHaveAttribute('src', /^data:image\/jpeg;base64,\/9j\//);

  // A new photo replaces the old one (which stays, voided); then the product has none.
  await page.goto(redPage);
  await editProduct(page, choosePicture);
  await expect
    .poll(async () => {
      const photos = await serverRecords<ServerPhoto>(request, 'photo');
      return [photos.length, photos.filter((photo) => photo.voidedAt === null).length];
    })
    .toEqual([3, 2]);
  await editProduct(page, (dialog) => dialog.getByRole('button', { name: 'احذف الصورة' }).click());
  await expect
    .poll(async () => {
      const photos = await serverRecords<ServerPhoto>(request, 'photo');
      return photos.filter((photo) => photo.voidedAt === null && photo.productId === red).length;
    })
    .toBe(0);
  await page.goto('/pos');
  await expect(tile).toBeVisible();
  await expect(tile.locator('img')).toHaveCount(0);
});
