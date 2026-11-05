import { type APIRequestContext, expect, type Locator, type Page } from '@playwright/test';
import { E2E } from './stack';

/**
 * The language a page opens in. The app's default is English; most specs read Arabic, so signIn()
 * opens the page in Arabic. A choice already made on the page (the language icon) is kept.
 */
export async function setDeviceLanguage(page: Page, language: 'ar' | 'en'): Promise<void> {
  await page.addInitScript((value) => {
    try {
      if (localStorage.getItem('fabric.language') === null) {
        localStorage.setItem('fabric.language', value);
      }
    } catch {
      // Storage blocked: the app keeps its default language.
    }
  }, language);
}

export async function signIn(
  page: Page,
  account: { username: string; password: string } = E2E.owner,
): Promise<void> {
  await setDeviceLanguage(page, 'ar');
  await page.goto('/login');
  await page.getByLabel('اسم المستخدم').fill(account.username);
  // Exact: the show-password button's name also contains these words.
  await page.getByLabel('كلمة المرور', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page).toHaveURL(/\/home$/);
}

/** The service worker controls the page once the app shell is precached. */
export async function waitForAppShell(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}

/** What the server has, straight from the API (what every other device will pull). */
export async function serverGet<T>(request: APIRequestContext, path: string): Promise<T> {
  const login = await request.post(`${E2E.apiUrl}/auth/login`, { data: E2E.owner });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const response = await request.get(`${E2E.apiUrl}${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return (await response.json()) as T;
}

/** A change made straight on the API as the owner (what another device would have synced). */
export async function serverPut<T>(
  request: APIRequestContext,
  path: string,
  data: unknown,
): Promise<T> {
  const login = await request.post(`${E2E.apiUrl}/auth/login`, { data: E2E.owner });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const response = await request.put(`${E2E.apiUrl}${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    data,
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as T;
}

/**
 * Picks an option of one of our comboboxes (Command + Popover). A popover that has just closed
 * hands focus back to its trigger, which can close the next one a moment after it opened (seen
 * when the machine is busy): open it again until the option can be clicked.
 */
export async function choose(page: Page, label: string, option: string): Promise<void> {
  const trigger = page.getByLabel(label, { exact: true });
  const choice = page.getByRole('option', { name: option, exact: true });
  await expect(async () => {
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
    await choice.click({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
}

/** The header's connectivity badge (other live regions, like toasts, are also role=status). */
export function connectivity(page: Page) {
  return page.getByRole('status').filter({ hasText: /متصل|دون اتصال/ });
}

/** What a purchase is typed as: amounts in rial and metres, as the forms take them. */
export interface StockEntry {
  /** What it was bought in; metres when left out. */
  unit?: 'kg' | 'meter' | 'piece';
  /** The weight in kg, the length in metres or the number of pieces. */
  quantity: string;
  /**
   * In rial (20 rial = 1 dh): the price of one metre, kilo or piece, by `unit`. The form works the
   * cost of the whole purchase out; a whole-purchase total is never typed.
   */
  cost: string;
  /** A weight whose cloth is known: `weight` kg make `length` m. Left out: awaiting measurement. */
  conversion?: { weight: string; length: string; estimated?: boolean };
  /** Restocking only. */
  supplier?: string;
  paid?: string;
}

const UNIT_NAME = { kg: 'كيلوغرام', meter: 'متر', piece: 'قطعة' } as const;
const COST_LABEL = {
  kg: 'تكلفة شراء الكيلوغرام',
  meter: 'تكلفة شراء المتر',
  piece: 'تكلفة شراء القطعة',
} as const;
const QUANTITY_LABEL = {
  kg: 'الوزن المستلم',
  meter: 'الطول المستلم',
  piece: 'القطع المستلمة',
} as const;

/** 50 m at 320 rial (16 dh) a metre: 16,000 rial in all. */
export const FIFTY_METERS: StockEntry = { quantity: '50', cost: '320' };

export async function fillStock(dialog: Locator, stock: StockEntry): Promise<void> {
  const unit = stock.unit ?? 'meter';
  await dialog.getByRole('radio', { name: UNIT_NAME[unit], exact: true }).click();
  await dialog.getByLabel(QUANTITY_LABEL[unit], { exact: true }).fill(stock.quantity);
  const costLabel = COST_LABEL[unit];
  await dialog.getByLabel(costLabel, { exact: true }).fill(stock.cost);
  if (unit === 'kg' && stock.conversion) {
    await dialog.getByRole('switch', { name: 'أعرف كم يعطي الوزن من القماش' }).click();
    await dialog.getByLabel('الوزن', { exact: true }).fill(stock.conversion.weight);
    await dialog.getByLabel('الطول', { exact: true }).fill(stock.conversion.length);
    if (stock.conversion.estimated) {
      await dialog.getByRole('radio', { name: 'تقديرية', exact: true }).click();
    }
  }
  if (stock.supplier) await choose(dialog.page(), 'المورد (اختياري)', stock.supplier);
  if (stock.paid) await dialog.getByLabel('المدفوع الآن (اختياري)').fill(stock.paid);
}

export interface ProductEntry {
  name: string;
  code?: string;
  /** The normal and the lowest price per metre, in rial: 400 and 360 when left out. */
  price?: string;
  min?: string;
  /** The first stock: 50 m for 16,000 rial when left out, none when `null`. */
  stock?: StockEntry | null;
  /** A picture file to give the product. */
  photo?: string;
}

/**
 * A product with its first stock, through the Add Product form of the Inventory. Returns the
 * product's id (the page it lands on is the product's). The specs share one server and one
 * database: give each product a name no other spec uses.
 */
export async function addProduct(page: Page, product: ProductEntry): Promise<string> {
  await page.goto('/inventory');
  await page.getByRole('button', { name: 'إضافة منتج' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('اسم المنتج', { exact: true }).fill(product.name);
  if (product.code) await dialog.getByLabel('الرمز (اختياري)').fill(product.code);
  if (product.photo) {
    await dialog.getByLabel('اختر صورة').setInputFiles(product.photo);
    // Saving waits for the picture to be made small, so the dialog shows it before the save.
    await expect(dialog.locator('img')).toBeVisible();
  }
  await dialog.getByLabel(/سعر البيع العادي/).fill(product.price ?? '400');
  await dialog.getByLabel(/السعر الأدنى للبيع/).fill(product.min ?? '360');
  const stock = product.stock === undefined ? FIFTY_METERS : product.stock;
  if (stock) await fillStock(dialog, stock);
  else await dialog.getByRole('switch', { name: 'أضف المخزون الأول الآن' }).click();
  await dialog.getByRole('button', { name: /^حفظ/ }).click();
  await expect(page).toHaveURL(/\/inventory\/product\?id=/);
  return new URL(page.url()).searchParams.get('id') ?? '';
}

/** The Quick Add Stock panel of a product's page (a desktop-sized window shows it beside the page). */
export async function openRestock(page: Page, productId: string): Promise<Locator> {
  await page.goto(`/inventory/product?id=${productId}`);
  const panel = page.getByRole('region', { name: 'إضافة مخزون', exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

/** Saves what the panel holds and waits until it is saved: the form comes back empty. */
export async function submitRestock(panel: Locator, unit: StockEntry['unit'] = 'meter') {
  await panel.getByRole('button', { name: 'إضافة المخزون', exact: true }).click();
  await expect(panel.getByLabel(QUANTITY_LABEL[unit], { exact: true })).toHaveValue('');
}

/** More stock for a product that exists: a batch of its own, from the product's page. */
export async function restock(page: Page, productId: string, stock: StockEntry): Promise<void> {
  const panel = await openRestock(page, productId);
  await fillStock(panel, stock);
  await submitRestock(panel, stock.unit);
}

/** A product's tile on the POS: its quantity and price dialog opens. */
export async function pickProduct(page: Page, name: string): Promise<Locator> {
  await page
    .getByRole('region', { name: 'بيع', exact: true })
    .getByRole('button', { name: new RegExp(name) })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * One line on the POS invoice, through the tile and its dialog (the length and the price are
 * typed into the fields; `price` in rial, the product's normal price when left out).
 */
export async function addToBill(
  page: Page,
  name: string,
  meters: string,
  price?: string,
): Promise<void> {
  const dialog = await pickProduct(page, name);
  await dialog.getByLabel('الطول', { exact: true }).fill(meters);
  if (price) await dialog.getByLabel('سعر المتر', { exact: true }).fill(price);
  await dialog.getByRole('button', { name: 'أضف إلى الفاتورة' }).click();
  await expect(dialog).toBeHidden();
}

/**
 * Pay the invoice in full: the sale is saved on the device at once and the invoice empties for
 * the next one (no page opens).
 */
export async function payInFull(page: Page): Promise<void> {
  // On a phone the invoice is a drawer behind a bar at the bottom of the screen.
  const bar = page.getByRole('button', { name: /^الفاتورة ·/ });
  if (await bar.isVisible()) await bar.click();
  await page.getByRole('button', { name: /^ادفع/ }).click();
  await expect(page.getByText('لا أصناف').first()).toBeVisible();
}

/** The newest sale on this device, opened from the history; returns its id. */
export async function openLastSale(page: Page): Promise<string> {
  await page.goto('/pos/history');
  await page.getByRole('table').getByRole('link').first().click();
  await expect(page).toHaveURL(/\/pos\/view\?id=/);
  return new URL(page.url()).searchParams.get('id') ?? '';
}

/** Every record of `entity` the server has, pulled page by page (voided ones included). */
export async function serverRecords<T>(request: APIRequestContext, entity: string): Promise<T[]> {
  const login = await request.post(`${E2E.apiUrl}/auth/login`, { data: E2E.owner });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const found: T[] = [];
  let since = 0;
  for (;;) {
    const response = await request.get(`${E2E.apiUrl}/sync/pull?since=${String(since)}&limit=500`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const page = (await response.json()) as {
      changes: { entity: string; record: T }[];
      nextSince: number;
      hasMore: boolean;
    };
    found.push(...page.changes.filter((change) => change.entity === entity).map((c) => c.record));
    since = page.nextSince;
    if (!page.hasMore) return found;
  }
}
