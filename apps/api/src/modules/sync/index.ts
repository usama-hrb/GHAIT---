// Public surface of the sync module. Other modules import from here only.
export { SyncModule } from './sync.module.js';
export {
  type PeriodGuard,
  type SyncedRow,
  type SyncHandler,
  SyncRegistry,
  SyncRejection,
} from './sync.registry.js';
export { SyncService } from './sync.service.js';
