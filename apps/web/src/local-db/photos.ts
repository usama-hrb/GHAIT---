import {
  currentPhotoOf,
  type Photo,
  type PhotoImage,
  photoImageSchema,
  photoSchema,
} from '@fabric/contracts';
import { parseOrThrow } from './errors';
import type { Local } from './db';
import type { LocalStore } from './store';
import { SyncedTable } from './tables';

/** The `src` of a photo: its JPEG, where it sits, as a data: URL. */
const sourceOf = (photo: Photo): string => `data:${photo.contentType};base64,${photo.data}`;

/**
 * The pictures of colours (ADR 0009). A colour shows its newest live photo; setting a picture
 * creates a photo and voids the colour's others, and a photo is never edited. Everything is saved
 * on the device first and syncs like any record.
 */
export class PhotosRepository extends SyncedTable<Photo> {
  constructor(store: LocalStore) {
    super(store, 'photos', 'photo', photoSchema);
  }

  /** The current picture of every colour that has one, as an image source, by variant id. */
  async sources(): Promise<Map<string, string>> {
    const live = await this.table.filter((photo) => photo.voidedAt === null).toArray();
    const byVariant = new Map<string, Local<Photo>[]>();
    for (const photo of live) {
      const group = byVariant.get(photo.variantId);
      if (group) group.push(photo);
      else byVariant.set(photo.variantId, [photo]);
    }
    const sources = new Map<string, string>();
    for (const [variantId, photos] of byVariant) {
      const current = currentPhotoOf(photos);
      if (current) sources.set(variantId, sourceOf(current));
    }
    return sources;
  }

  /** Gives the colour this picture: a new photo, and the colour's earlier ones voided. */
  async set(variantId: string, image: PhotoImage): Promise<string> {
    const fields = parseOrThrow(photoImageSchema, image);
    const earlier = await this.liveOf(variantId);
    const id = await this.write({ variantId, ...fields });
    for (const photo of earlier) await this.void(photo.id, 'replaced');
    return id;
  }

  /** Takes the colour's picture away: its live photos are voided (never deleted). */
  async remove(variantId: string): Promise<void> {
    for (const photo of await this.liveOf(variantId)) await this.void(photo.id, 'removed');
  }

  private liveOf(variantId: string): Promise<Local<Photo>[]> {
    return this.table
      .where('variantId')
      .equals(variantId)
      .filter((photo) => photo.voidedAt === null)
      .toArray();
  }
}
