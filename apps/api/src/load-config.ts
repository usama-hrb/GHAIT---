import { type AppConfig, InvalidConfigError, parseConfig } from './config/index.js';

/** Fail fast: an invalid environment stops the process before anything else runs. */
export function loadConfig(): AppConfig {
  try {
    return parseConfig(process.env);
  } catch (error) {
    if (error instanceof InvalidConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}
