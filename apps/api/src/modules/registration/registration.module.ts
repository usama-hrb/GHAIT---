import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { SettingsModule } from '../settings/index.js';
import { RegistrationController } from './registration.controller.js';
import { RegistrationService } from './registration.service.js';

@Module({
  imports: [AuthModule, SettingsModule],
  controllers: [RegistrationController],
  providers: [RegistrationService],
})
export class RegistrationModule {}
