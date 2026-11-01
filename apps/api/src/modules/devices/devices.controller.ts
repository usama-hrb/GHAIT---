import { type DeviceRegistration, deviceRegistrationSchema } from '@fabric/contracts';
import { Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from '../../common/index.js';
import { AuditExempt } from '../audit/index.js';
import { CashierMayCall, PartnerMayCall } from '../auth/index.js';
import { DevicesService } from './devices.service.js';

@ApiTags('devices')
@ApiBearerAuth()
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  /** Called by the web app after signing in; answers the same code every time. */
  @Post('register')
  @PartnerMayCall()
  @CashierMayCall()
  @AuditExempt('idempotent: audits the registration in its own transaction, the first time only')
  @HttpCode(200)
  @ZodResponse(deviceRegistrationSchema)
  register(): Promise<DeviceRegistration> {
    return this.devices.register();
  }
}
