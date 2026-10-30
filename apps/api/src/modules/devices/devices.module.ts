import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/index.js';
import { DevicesController } from './devices.controller.js';
import { DevicesService } from './devices.service.js';

@Module({
  imports: [AuditModule],
  controllers: [DevicesController],
  providers: [DevicesService],
})
export class DevicesModule {}
