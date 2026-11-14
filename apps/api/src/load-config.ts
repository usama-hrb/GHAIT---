import { type AppConfig, InvalidConfigError, parseConfig } from './config/index.js';

/**
 * Fail fast: an invalid environment stops the process before anything else runs. `overrides` are
 * variables a command sets itself, over the environment (`shop-adopt` turns MULTI_SHOP on).
 */
export function loadConfig(overrides: Readonly<Record<string, string>> = {}): AppConfig {
  try {
    return parseConfig({ ...process.env, ...overrides });
  } catch (error) {
    if (error instanceof InvalidConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}
