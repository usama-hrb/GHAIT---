import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import {
  addProduct,
  addToBill,
  connectivity,
  payInFull,
  setDeviceLanguage,
  signIn,
  waitForAppShell,
} from './helpers';
import { E2E, SECOND_SHOP, setupCodeVariable } from './stack';

/**
 * A second shop on the same server (ADR 0029, Step 9): its owner signs up with the setup code at
 * its own address, adds a product, sells with the Wi-Fi off, and the sale reaches the server once
 * the device is back online and another device of that shop. The shared shop (the one every other
 * spec uses, at 127.0.0.1) is looked at before and after and is the same, and the two shops'
 * accounts do not open each other. The shop is made by e2e/global-setup.ts with its own database,
 * so nothing here can disturb the specs that share one. Needs a server with many shops
 * (`E2E_SHOPS=adopted`, `make e2e-shops`).
 */
test.skip(process.env.E2E_SHOPS !== 'adopted', 'needs a multi-shop server: E2E_SHOPS=adopted');

const BASE_URL = `http://${SECOND_SHOP.host}:${String(E2E.webPort)}`;
const SHARED_SHOP = '127.0.0.1';
const OWNER = {
  name: 'زينب العلوي',
  email: 'zaynab@example.com',
  password: 'a long password for the second shop',
};
const SHOP_NAME = 'دار الزهراء';
const PRODUCT = 'قطن الجنوب';

interface Change {
  entity: string;
  record: { id: string } & Record<string, unknown>;
}

/** The owner's token at the shop of `host` (the API takes the shop from the address, as Caddy sends it). */
async function login(
  request: APIRequestContext,
  host: string,
  account: { username: string; password: string },
) {
  return request.post(`${E2E.apiUrl}/auth/login`, {
    data: account,
    headers: { 'x-forwarded-host': host },
  });
}

async function tokenAt(
  request: APIRequestContext,
  host: string,
  account: { username: string; password: string },
): Promise<string> {
  const response = await login(request, host, account);
  expect(response.ok(), `sign in at ${host}`).toBe(true);
  return ((await response.json()) as { accessToken: string }).accessToken;
}

/** Everything a shop would give a device that pulls from the start. */
async function pullEverything(
  request: APIRequestContext,
  host: string,
  token: string,
): Promise<Change[]> {
  const found: Change[] = [];
  let since = 0;
  for (;;) {
    const response = await request.get(`${E2E.apiUrl}/sync/pull?since=${String(since)}&limit=500`, {
      headers: { authorization: `Bearer ${token}`, 'x-forwarded-host': host },
    });
    expect(response.ok(), `pull at ${host}`).toBe(true);
    const page = (await response.json()) as {
      changes: Change[];
      nextSince: number;
      hasMore: boolean;
    };
    found.push(...page.changes);
    since = page.nextSince;
    if (!page.hasMore) return found;
  }
}

const keysOf = (changes: Change[]): string[] =>
  changes.map((change) => `${change.entity}:${change.record.id}`).sort();

/** The wizard of a shop that waits for its owner, in Arabic (e2e/signup-new-shop.spec.ts has it in full). */
async function signUp(page: Page, code: string): Promise<void> {
  const next = () => page.getByRole('button', { name: 'متابعة' }).click();
  await page.goto('/signup');
  await expect(page.getByRole('heading', { level: 1, name: 'أنشئ محلّك' })).toBeVisible();
  await page.getByLabel('رمز الإعداد').fill(code);
  await page.getByLabel('الاسم الكامل').fill(OWNER.name);
  await page.getByLabel('البريد الإلكتروني').fill(OWNER.email);
  await page.getByLabel('كلمة المرور', { exact: true }).fill(OWNER.password);
  await page.getByLabel('تأكيد كلمة المرور', { exact: true }).fill(OWNER.password);
  await next();
  await page.getByLabel('اسم المحل').fill(SHOP_NAME);
  await next();
  await page.getByRole('switch', { name: /متر \(m\)/ }).click();
  await next();
  await page.getByRole('button', { name: 'أنشئ محلّي' }).click();
  await expect(page).toHaveURL(/\/home$/);
}

test('a second shop signs up, sells offline and syncs, and the first shop does not change', async ({
  browser,
  request,
}) => {
  const code = process.env[setupCodeVariable(SECOND_SHOP.slug)];
  if (code === undefined) throw new Error('no setup code for the second shop: see global-setup');

  // The shared shop as it is now (empty when this spec runs alone, full after the others: the
  // comparison at the end holds either way, and the API spec test/cross-shop.e2e-spec.ts is the
  // one that proves a shop with records is not read through the other).
  const sharedToken = await tokenAt(request, SHARED_SHOP, E2E.owner);
  const sharedBefore = keysOf(await pullEverything(request, SHARED_SHOP, sharedToken));

  // The second shop waits for its owner, and the code is the way in.
  const status = await request.get(`${E2E.apiUrl}/auth/registration`, {
    headers: { 'x-forwarded-host': SECOND_SHOP.host },
  });
  expect(await status.json()).toMatchObject({ open: true, setupCodeRequired: true });

  const desk = await browser.newContext({ baseURL: BASE_URL });
  const page = await desk.newPage();
  await setDeviceLanguage(page, 'ar');
  await signUp(page, code);
  await expect(page.getByText(SHOP_NAME).first()).toBeVisible();
  await waitForAppShell(page);

  // A product with its first stock (400 rial a metre, 50 m for 16,000 rial), saved while online.
  await addProduct(page, { name: PRODUCT });
  const status2 = connectivity(page);
  await expect(status2).toContainText('متصل');
  await expect(status2).not.toContainText(/معلّق/);

  // Wi-Fi off: the sale is made and kept on the device, waiting.
  await desk.setOffline(true);
  await expect(status2).toContainText('دون اتصال');
  await page.goto('/pos');
  await addToBill(page, PRODUCT, '1.5');
  await payInFull(page);
  await expect(status2).toContainText(/معلّق/);
  const ownerToken = await tokenAt(request, SECOND_SHOP.host, {
    username: OWNER.email,
    password: OWNER.password,
  });
  const sales = async () =>
    (await pullEverything(request, SECOND_SHOP.host, ownerToken)).filter(
      (change) => change.entity === 'sale',
    );
  expect(await sales()).toHaveLength(0);

  // Back online: it drains by itself, and the shop's server has the sale (1.5 m at 400 rial).
  await desk.setOffline(false);
  await expect(status2).not.toContainText(/معلّق/);
  await expect
    .poll(async () => (await sales()).map((sale) => sale.record['totalCents']))
    .toEqual([3000]);

  // A second device of the same shop signs in with the owner's account and pulls the product.
  const phone = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const phonePage = await phone.newPage();
  await signIn(phonePage, { username: OWNER.email, password: OWNER.password });
  await phonePage.goto('/inventory');
  await expect(phonePage.getByRole('link', { name: new RegExp(PRODUCT) })).toBeVisible();

  // What the second shop has is its own: its product, and nothing of the shared shop's.
  const own = await pullEverything(request, SECOND_SHOP.host, ownerToken);
  expect(
    own.filter((change) => change.entity === 'product').map((change) => change.record['name']),
  ).toEqual([PRODUCT]);
  expect(own.filter((change) => change.entity === 'customer')).toHaveLength(0);

  // The first shop is exactly as it was: no record came in, and none of this shop's is there.
  const sharedAfter = await pullEverything(request, SHARED_SHOP, sharedToken);
  expect(keysOf(sharedAfter)).toEqual(sharedBefore);
  expect(JSON.stringify(sharedAfter)).not.toContain(PRODUCT);

  // The accounts belong to their shops: neither opens the other.
  expect(
    (await login(request, SECOND_SHOP.host, E2E.owner)).status(),
    'the shared shop’s owner at the second shop',
  ).toBe(401);
  expect(
    (
      await login(request, SHARED_SHOP, { username: OWNER.email, password: OWNER.password })
    ).status(),
    'the second shop’s owner at the shared shop',
  ).toBe(401);
  const crossed = await request.get(`${E2E.apiUrl}/customers`, {
    headers: { authorization: `Bearer ${ownerToken}`, 'x-forwarded-host': SHARED_SHOP },
  });
  expect(crossed.status(), 'the second shop’s token at the shared shop').toBe(401);

  await desk.close();
  await phone.close();
});
