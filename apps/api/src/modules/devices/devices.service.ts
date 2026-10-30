import { type DeviceRegistration, SERVER_DEVICE_ID } from '@fabric/contracts';
import { HttpStatus, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { AppHttpException, requestContext } from '../../common/index.js';
import { schema, TransactionHost } from '../../database/index.js';
import { AuditService } from '../audit/index.js';
import { deviceCodeOf } from './device-code.js';

/**
 * Devices get a short code once, at sign-in; they prefix the roll codes they make offline with
 * it (R-A0001), so codes are unique without asking the server each time (BUILD_PROMPTS 3.2).
 */
@Injectable()
export class DevicesService {
  constructor(
    private readonly tx: TransactionHost,
    private readonly audit: AuditService,
  ) {}

  /** The calling device's code (from x-device-id), assigned the first time. Idempotent. */
  register(): Promise<DeviceRegistration> {
    const key = requestContext()?.deviceId;
    if (!key || key === SERVER_DEVICE_ID) {
      throw new AppHttpException(
        'bad_request',
        'Send the device id (x-device-id)',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.tx.run(async () => {
      const [existing] = await this.tx.db
        .select()
        .from(schema.device)
        .where(eq(schema.device.key, key));
      if (existing) return { code: existing.code };
      const result = await this.tx.db.execute<{ n: string }>(
        sql`SELECT nextval('device_code_seq') AS n`,
      );
      const code = deviceCodeOf(Number(result.rows[0]?.n));
      const [device] = await this.tx.db
        .insert(schema.device)
        .values({ key, code, deviceId: key })
        .returning();
      if (!device) throw new Error('insert returned no row');
      await this.audit.record({
        entity: 'device',
        entityId: device.id,
        action: 'create',
        before: null,
        after: { key, code },
      });
      return { code };
    });
  }
}
