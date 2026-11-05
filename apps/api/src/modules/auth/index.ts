// Public surface of the auth module. Other modules import from here only.
export {
  type AuthenticatedUser,
  CashierMayCall,
  CurrentUser,
  PartnerMayCall,
  Public,
} from './auth.decorators.js';
export { AuthModule } from './auth.module.js';
export { AuthService, auditView, type IssuedTokens } from './auth.service.js';
export { PasswordHasher } from './password-hasher.js';
export { setRefreshCookie } from './refresh-cookie.js';
export { SessionsRepository } from './sessions.repository.js';
export type { UserRow } from './users.repository.js';
