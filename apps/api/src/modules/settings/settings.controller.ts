import {
  type PutSettingRequest,
  putSettingRequestSchema,
  type Setting,
  settingAtQuerySchema,
  type SettingKey,
  settingKeySchema,
  settingListSchema,
  settingSchema,
} from '@fabric/contracts';
import { Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { ZodBody, ZodParam, ZodQuery, ZodResponse } from '../../common/index.js';
import { SettingsService } from './settings.service.js';

type AtQuery = z.infer<typeof settingAtQuerySchema>;

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ZodResponse(settingListSchema)
  list(@ZodQuery(settingAtQuerySchema) query: AtQuery): Promise<Setting[]> {
    return this.settings.list(query.at);
  }

  @Get(':key')
  @ZodResponse(settingSchema)
  get(
    @ZodParam('key', settingKeySchema) key: SettingKey,
    @ZodQuery(settingAtQuerySchema) query: AtQuery,
  ): Promise<Setting> {
    return this.settings.get(key, query.at);
  }

  @Put(':key')
  @ZodResponse(settingSchema)
  put(
    @ZodParam('key', settingKeySchema) key: SettingKey,
    @ZodBody(putSettingRequestSchema) body: PutSettingRequest,
  ): Promise<Setting> {
    return this.settings.put(key, body);
  }
}
