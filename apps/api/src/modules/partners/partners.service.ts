import {
  capitalMoveFields,
  type NewCapitalMoveInput,
  newCapitalMoveSchema,
  type NewPartnerDrawInput,
  newPartnerDrawSchema,
  type PartnerInput,
  partnerAccountOf,
  partnerInputSchema,
  SERVER_DEVICE_ID,
  type SyncEntity,
} from '@fabric/contracts';
import type { PartnerAccount } from '@fabric/core';
import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import { AppHttpException, requestContext } from '../../common/index.js';
import { type SyncedRow, SyncRegistry, SyncService } from '../sync/index.js';
import {
  CapitalMoveRepository,
  PartnerDrawRepository,
  PartnerRepository,
} from './partners.repositories.js';

const stored = <R>(row: SyncedRow<R>) => ({ ...row.record, serverSeq: row.serverSeq });

/**
 * The partners, their capital and their draws (SPEC §6, §7, §8.4, BUILD_PROMPTS 4.2). Every
 * figure of an account comes from the records (@fabric/core partnerAccount). Devices write
 * through sync; these REST operations take the same path.
 */
@Injectable()
export class PartnersService implements OnModuleInit {
  constructor(
    private readonly registry: SyncRegistry,
    private readonly sync: SyncService,
    private readonly partners: PartnerRepository,
    private readonly moves: CapitalMoveRepository,
    private readonly draws: PartnerDrawRepository,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.partners);
    this.registry.register(this.moves);
    this.registry.register(this.draws);
  }

  async list() {
    return (await this.partners.list()).map(stored);
  }

  putPartner(id: string, input: PartnerInput) {
    return this.save('partner', id, partnerInputSchema.parse(input));
  }

  async account(id: string): Promise<{ partnerId: string; account: PartnerAccount }> {
    if (!(await this.partners.find(id)))
      throw new AppHttpException('not_found', `No partner ${id}`, HttpStatus.NOT_FOUND);
    const [moves, draws, shares] = await Promise.all([
      this.moves.listAll(),
      this.draws.listAll(),
      this.moves.shares(),
    ]);
    return {
      partnerId: id,
      account: partnerAccountOf(id, {
        capitalMoves: moves.map((row) => row.record),
        draws: draws.map((row) => row.record),
        shares,
      }),
    };
  }

  recordCapitalMove(id: string, input: NewCapitalMoveInput) {
    return this.save('capital_move', id, capitalMoveFields(newCapitalMoveSchema.parse(input)));
  }

  recordDraw(id: string, input: NewPartnerDrawInput) {
    return this.save('partner_draw', id, newPartnerDrawSchema.parse(input));
  }

  async void(entity: 'capital_move' | 'partner_draw', id: string, reason: string) {
    return stored(await this.sync.voidDirect(entity, id, reason));
  }

  /** Creates or updates through SyncService (validation, the entity's own checks, audit). */
  private async save(entity: SyncEntity, id: string, fields: object) {
    const current = await this.sync.find(entity, id);
    const now = new Date().toISOString();
    return stored(
      await this.sync.saveDirect(entity, {
        ...fields,
        id,
        createdAt: current?.record.createdAt ?? now,
        updatedAt: now,
        deviceId: requestContext()?.deviceId ?? SERVER_DEVICE_ID,
        voidedAt: current?.record.voidedAt ?? null,
      }),
    );
  }
}
