import { type DynamicModule, Module } from '@nestjs/common';
import type { AppConfig } from '../../config/index.js';
import { ControlDatabaseModule } from '../../database/index.js';
import { AuthModule } from '../auth/index.js';
import { SettingsModule } from '../settings/index.js';
import { RegistrationController } from './registration.controller.js';
import { RegistrationService } from './registration.service.js';
import { SetupCodes } from './setup-codes.service.js';

@Module({
  imports: [AuthModule, SettingsModule],
  controllers: [RegistrationController],
  providers: [RegistrationService],
})
export class RegistrationModule {
  /**
   * On a server with many shops the sign-up checks a setup code (ADR 0029, Step 6), which needs
   * the control database; a one-shop server has neither and signs up as it always did.
   */
  static forRoot(config: AppConfig): DynamicModule {
    return config.multiShop
      ? { module: RegistrationModule, imports: [ControlDatabaseModule], providers: [SetupCodes] }
      : { module: RegistrationModule };
  }
}
