import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2023',
  dts: true,
  sourcemap: true,
  // Not in watch mode: an emptied dist/ would crash the API and web dev servers mid-rebuild.
  clean: !options.watch,
}));
