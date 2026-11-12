import {
  isDrawOfZakatPayment,
  type NewZakatPayment,
  newZakatPaymentSchema,
  SERVER_DEVICE_ID,
  ZAKAT_ISSUES,
  type ZakatReportDetail,
  zakatDrawIdOf,
  zakatPaidCents,
  zakatPaymentReason,
  zakatPaymentShares,
} from '@fabric/contracts';
import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import { AppHttpException, requestContext } from '../../common/index.js';
import { TransactionHost } from '../../database/index.js';
import { type SyncedRow, SyncRegistry, SyncService } from '../sync/index.js';
import { ZakatReportRepository } from './zakat.repositories.js';

const stored = <R>(row: SyncedRow<R>) => ({ ...row.record, serverSeq: row.serverSeq });

/**
 * Zakat (SPEC §10, BUILD_PROMPTS 5.1): reports are computed and saved on a device (from its
 * records, @fabric/contracts zakatReportFieldsOf) and re-checked here; paying one records a
 * draw per partner by ownership (Z7).
 */
@Injectable()
export class ZakatService implements OnModuleInit {
  constructor(
    private readonly registry: SyncRegistry,
    private readonly sync: SyncService,
    private readonly reports: ZakatReportRepository,
    private readonly tx: TransactionHost,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.reports);
  }

  async list() {
    return (await this.reports.list()).map(stored);
  }

  async detail(id: string): Promise<ZakatReportDetail> {
    const row = await this.reports.find(id);
    if (!row)
      throw new AppHttpException('not_found', `No zakat report ${id}`, HttpStatus.NOT_FOUND);
    const draws = (await this.sync.readAll('partner_draw')).filter(
      (draw) => draw.record.zakatReportId === id,
    );
    return {
      report: stored(row),
      paidCents: zakatPaidCents(
        id,
        draws.map((draw) => draw.record),
      ),
      payments: draws.map(stored),
    };
  }

  /**
   * Pays zakat on a report: one draw per partner by ownership, never beyond what is due. A payment
   * that names itself (`paymentId`) is recorded once: sending it again, after a lost answer or a
   * second tap, changes nothing and answers as the first time did. Naming a payment already
   * recorded but with another amount or day is refused, so an id is never reused for a different
   * payment. It runs in a transaction of its own, so a payment's draws are all written or none,
   * and two payments never read the same "paid so far" (ADR 0028).
   */
  pay(id: string, input: NewZakatPayment): Promise<ZakatReportDetail> {
    const payment = newZakatPaymentSchema.parse(input);
    return this.tx.run(async () => {
      const before = await this.detail(id);
      const { paymentId } = payment;
      if (paymentId !== undefined) {
        const earlier = before.payments.filter((draw) => isDrawOfZakatPayment(draw, paymentId));
        if (earlier.length > 0) {
          const sameAmount =
            earlier.reduce((sum, draw) => sum + draw.amountCents, 0) === payment.amountCents;
          const sameDay = earlier.every((draw) => draw.date === payment.date);
          if (sameAmount && sameDay) return before;
          throw new AppHttpException(
            'validation_failed',
            'This payment was recorded with other details',
            HttpStatus.BAD_REQUEST,
            [{ path: ['paymentId'], message: ZAKAT_ISSUES.paymentReused, code: 'custom' }],
          );
        }
      }
      if (
        before.report.voidedAt !== null ||
        before.paidCents + payment.amountCents > before.report.zakatDueCents
      ) {
        throw new AppHttpException(
          'validation_failed',
          'More than is due',
          HttpStatus.BAD_REQUEST,
          [{ path: ['amountCents'], message: ZAKAT_ISSUES.aboveDue, code: 'custom' }],
        );
      }
      const partners = (await this.sync.readAll('partner')).map((row) => row.record);
      const now = new Date().toISOString();
      const reason = zakatPaymentReason(before.report.hawlDate, payment.note);
      for (const share of zakatPaymentShares(payment.amountCents, partners)) {
        await this.sync.saveDirect('partner_draw', {
          id:
            paymentId === undefined
              ? crypto.randomUUID()
              : zakatDrawIdOf(paymentId, share.partnerId),
          createdAt: now,
          updatedAt: now,
          deviceId: requestContext()?.deviceId ?? SERVER_DEVICE_ID,
          voidedAt: null,
          partnerId: share.partnerId,
          amountCents: share.amountCents,
          date: payment.date,
          reason,
          zakatReportId: id,
        });
      }
      return this.detail(id);
    });
  }

  async void(id: string, reason: string) {
    return stored(await this.sync.voidDirect('zakat_report', id, reason));
  }
}
