/** Where the e2e stack listens and who signs in (shared by the config, setup and tests). */
export const E2E = {
  apiPort: Number(process.env.E2E_API_PORT ?? 4310),
  webPort: Number(process.env.E2E_WEB_PORT ?? 3310),
  get apiUrl() {
    return `http://127.0.0.1:${String(this.apiPort)}`;
  },
  get webUrl() {
    return `http://127.0.0.1:${String(this.webPort)}`;
  },
  owner: { username: 'owner', password: 'end to end test password' },
  cashier: { username: 'cashier', password: 'a cashier test password' },
} as const;

/**
 * The shops the sign-up wizard is run on (`E2E_SHOPS=adopted` only; ADR 0029, Step 6). Each is made
 * before the server runs with many shops, as `make shop-new` makes one, and waits for its owner at
 * its own address: browsers reach `*.localhost` on the loopback with no setup. The setup code of
 * each (shown once by the command) is handed to the specs in an environment variable.
 */
export const SIGNUP_SHOPS = [
  { language: 'en', slug: 'e2e_signup_en', host: 'signup-en.localhost' },
  { language: 'ar', slug: 'e2e_signup_ar', host: 'signup-ar.localhost' },
] as const;

/**
 * A second shop for the specs that need a shop of their own next to the shared one (`E2E_SHOPS=adopted`;
 * ADR 0029, Step 9): made the same way, at `shop2.localhost`, with its own database. The spec signs
 * up its owner, sells and syncs there, and looks at the shared shop to see that it did not change.
 */
export const SECOND_SHOP = { slug: 'e2e_second', host: 'shop2.localhost' } as const;

export const setupCodeVariable = (slug: string) => `E2E_SETUP_CODE_${slug.toUpperCase()}`;
