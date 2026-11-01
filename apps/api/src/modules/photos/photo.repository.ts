import { checkUnchanged, type Photo, PHOTO_ISSUES, SYNC_BATCH_MAX_BYTES } from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { baseOf, schema, TransactionHost } from '../../database/index.js';
import { type SyncedRow, type SyncHandler, SyncRejection } from '../sync/index.js';

type PhotoRow = typeof schema.photo.$inferSelect;

function photoOf(row: PhotoRow): SyncedRow<Photo> {
  return {
    serverSeq: row.serverSeq,
    record: {
      ...baseOf(row),
      variantId: row.variantId,
      contentType: 'image/jpeg',
      width: row.width,
      height: row.height,
      byteLength: row.byteLength,
      data: row.data,
    },
  };
}

const FIELDS = ['variantId', 'contentType', 'width', 'height', 'byteLength', 'data'] as const;

/** Photos of colours (ADR 0009): created once, then only voided; their image never reaches a log. */
@Injectable()
export class PhotoRepository implements SyncHandler<'photo'> {
  readonly entity = 'photo' as const;

  constructor(private readonly tx: TransactionHost) {}

  async find(id: string): Promise<SyncedRow<Photo> | undefined> {
    const [row] = await this.tx.db.select().from(schema.photo).where(eq(schema.photo.id, id));
    return row && photoOf(row);
  }

  async write(record: Photo): Promise<SyncedRow<Photo>> {
    const current = await this.find(record.id);
    if (current) {
      const issues = checkUnchanged(current.record, record, FIELDS, PHOTO_ISSUES.fixed);
      if (issues.length > 0)
        throw new SyncRejection('validation_failed', 'A photo is never edited', issues);
      return current;
    }
    const [row] = await this.tx.db
      .insert(schema.photo)
      .values({
        id: record.id,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
        deviceId: record.deviceId,
        variantId: record.variantId,
        contentType: record.contentType,
        width: record.width,
        height: record.height,
        byteLength: record.byteLength,
        data: record.data,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return photoOf(row);
  }

  async markVoided(id: string, at: Date, deviceId: string): Promise<SyncedRow<Photo>> {
    const [row] = await this.tx.db
      .update(schema.photo)
      .set({ voidedAt: at, updatedAt: at, deviceId })
      .where(eq(schema.photo.id, id))
      .returning();
    if (!row) throw new Error(`no photo ${id}`);
    return photoOf(row);
  }

  /**
   * The next photos after `since`, oldest first: at most `limit`, and stopping at the photo that
   * takes their images over a page's byte budget (SyncService.pull cuts the page there, so
   * nothing after it may be returned). The images are read only for the photos kept.
   */
  async pull(since: number, limit: number): Promise<SyncedRow<Photo>[]> {
    const sizes = await this.tx.db
      .select({
        id: schema.photo.id,
        weight: sql<number>`length(${schema.photo.data})`.mapWith(Number),
      })
      .from(schema.photo)
      .where(gt(schema.photo.serverSeq, since))
      .orderBy(asc(schema.photo.serverSeq))
      .limit(limit);
    const ids: string[] = [];
    let weight = 0;
    for (const size of sizes) {
      ids.push(size.id);
      weight += size.weight;
      if (weight > SYNC_BATCH_MAX_BYTES) break;
    }
    if (ids.length === 0) return [];
    const rows = await this.tx.db
      .select()
      .from(schema.photo)
      .where(and(inArray(schema.photo.id, ids)))
      .orderBy(asc(schema.photo.serverSeq));
    return rows.map(photoOf);
  }

  /** The photo as the audit and conflict logs keep it: what it is, not its bytes. */
  auditView(record: Photo): unknown {
    return { ...record, data: `[JPEG ${String(record.byteLength)} bytes]` };
  }
}
