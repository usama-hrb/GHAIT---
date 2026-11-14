import { defineConfig } from 'drizzle-kit';

// The control database (ADR 0029) has migrations of its own, apart from the shops':
// `pnpm db:generate:control` writes them to ./drizzle-control from its TypeScript schema. They are
// committed and reviewed like the shops' (ADR 0003), and applied first (prepareControlDatabase).
// Generating needs no database.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/control/schema.ts',
  out: './drizzle-control',
  casing: 'snake_case',
  strict: true,
  verbose: true,
});
