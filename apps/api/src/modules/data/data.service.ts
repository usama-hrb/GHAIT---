import {
  type DataExport,
  dataExportSchema,
  EXPORT_ENTITIES,
  type Roll,
  SERVER_DEVICE_ID,
} from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { TransactionHost } from '../../database/index.js';
import { AuditService } from '../audit/index.js';
import { deviceNumberOf } from '../devices/index.js';
import { SyncService } from '../sync/index.js';
import { DataRepository } from './data.repository.js';

const ROLL_CODE = /^R-([A-Z]{1,3})\d+$/;

/**
 * The shop's data as one file, and back (BUILD_PROMPTS 3.6, docs/runbooks/backup.md): the
 * export is what devices pull, so a device's export from the settings screen has the same shape
 * and can rebuild a server that lost its database and its backups.
 */
@Injectable()
export class DataService {
  constructor(
    private readonly sync: SyncService,
    private readonly data: DataRepository,
    private readonly audit: AuditService,
    private readonly tx: TransactionHost,
  ) {}

  async exportAll(now = new Date()): Promise<DataExport> {
    const records = Object.fromEntries(EXPORT_ENTITIES.map((entity) => [entity, [] as unknown[]]));
    for (let since = 0; ;) {
      const page = await this.sync.pull({ since, limit: 500 });
      for (const change of page.changes) records[change.entity]?.push(change.record);
      since = page.nextSince;
      if (!page.hasMore) break;
    }
    return dataExportSchema.parse({
      format: 'fabric-shop-export',
      version: 1,
      exportedAt: now.toISOString(),
      source: 'server',
      devices: await this.data.devices(),
      records,
    });
  }

  /**
   * Loads an export into an empty database, all or nothing, then starts a new epoch so every
   * device pulls the restored data from scratch. Returns how many records of each entity.
   */
  async importAll(file: unknown): Promise<Record<string, number>> {
    const parsed = dataExportSchema.parse(file);
    return this.tx.run(async () => {
      if ((await this.data.businessRows()) > 0) {
        throw new Error('The database already has shop data: import only into an empty one');
      }
      const counts: Record<string, number> = {};
      for (const entity of EXPORT_ENTITIES) {
        const records = parsed.records[entity];
        await this.data.insert(entity, records);
        counts[entity] = records.length;
      }
      const devices = this.devicesOf(parsed);
      await this.data.insertDevices(
        devices,
        Math.max(0, ...devices.map((device) => deviceNumberOf(device.code))),
      );
      await this.data.newEpoch();
      await this.audit.record({
        entity: 'data_import',
        entityId: crypto.randomUUID(),
        action: 'create',
        before: null,
        after: { source: parsed.source, exportedAt: parsed.exportedAt, counts },
        deviceId: SERVER_DEVICE_ID,
      });
      return counts;
    });
  }

  /** The export's devices; a device's export has none, so the roll codes say which were used. */
  private devicesOf(file: DataExport): { key: string; code: string }[] {
    if (file.devices.length > 0) return file.devices;
    const codes = new Set(
      file.records.roll.flatMap((roll: Roll) => ROLL_CODE.exec(roll.shortCode)?.[1] ?? []),
    );
    return [...codes].map((code) => ({ key: `restored-${code}`, code }));
  }
}
