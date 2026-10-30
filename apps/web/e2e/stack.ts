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
} as const;
