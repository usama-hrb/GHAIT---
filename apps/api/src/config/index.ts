export { APP_CONFIG, ConfigModule } from './config.module.js';
export {
  type AppConfig,
  DATABASE_NAME_PATTERN,
  databaseNameOf,
  InvalidConfigError,
  parseConfig,
} from './env.js';
