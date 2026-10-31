import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/index.js';
import { PartnersController } from './partners.controller.js';
import {
  CapitalMoveRepository,
  PartnerDrawRepository,
  PartnerRepository,
} from './partners.repositories.js';
import { PartnersService } from './partners.service.js';

@Module({
  imports: [SyncModule],
  controllers: [PartnersController],
  providers: [PartnersService, PartnerRepository, CapitalMoveRepository, PartnerDrawRepository],
  exports: [PartnersService],
})
export class PartnersModule {}
