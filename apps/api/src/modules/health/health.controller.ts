import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/index.js';

export interface HealthStatus {
  status: 'ok';
}

/** Liveness for Docker and Caddy; no database round trip. */
@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  @Get()
  check(): HealthStatus {
    return { status: 'ok' };
  }
}
