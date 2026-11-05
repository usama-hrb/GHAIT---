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
 * The pictures of products (ADR 0009, 0012). A product shows its newest live photo; setting a picture
 * creates a photo and voids the product's others, and a photo is never edited. Everything is saved
 * on the device first and syncs like any record.
 */
export class PhotosRepository extends SyncedTable<Photo> {
  constructor(store: LocalStore) {
    super(store, 'photos', 'photo', photoSchema);
  }

  /** The current picture of every product that has one, as an image source, by product id. */
  async sources(): Promise<Map<string, string>> {
    const live = await this.table.filter((photo) => photo.voidedAt === null).toArray();
    const byProduct = new Map<string, Local<Photo>[]>();
    for (const photo of live) {
      const group = byProduct.get(photo.productId);
      if (group) group.push(photo);
      else byProduct.set(photo.productId, [photo]);
    }
    const sources = new Map<string, string>();
    for (const [productId, photos] of byProduct) {
      const current = currentPhotoOf(photos);
      if (current) sources.set(productId, sourceOf(current));
    }
    return sources;
  }

  /** Gives the product this picture: a new photo, and the product's earlier ones voided. */
  async set(productId: string, image: PhotoImage): Promise<string> {
    const fields = parseOrThrow(photoImageSchema, image);
    const earlier = await this.liveOf(productId);
    const id = await this.write({ productId, ...fields });
    for (const photo of earlier) await this.void(photo.id, 'replaced');
    return id;
  }

  /** Takes the product's picture away: its live photos are voided (never deleted). */
  async remove(productId: string): Promise<void> {
    for (const photo of await this.liveOf(productId)) await this.void(photo.id, 'removed');
  }

  private liveOf(productId: string): Promise<Local<Photo>[]> {
    return this.table
      .where('productId')
      .equals(productId)
      .filter((photo) => photo.voidedAt === null)
      .toArray();
  }
}
