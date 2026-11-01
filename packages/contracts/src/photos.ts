import { z } from 'zod';
import { recordBaseSchema } from './catalog.js';
import { idSchema } from './common.js';

/** The longest side, in pixels, of a photo as a device stores it (a tile is ~200 px: 2× is plenty). */
export const PHOTO_MAX_SIDE = 480;
/** What a device aims for when it compresses a picked image. */
export const PHOTO_TARGET_BYTES = 120_000;
/** What the server accepts: above the target, so a slightly different encoder still fits. */
export const PHOTO_LIMIT_BYTES = 250_000;

/** Issue messages for rules zod has no built-in code for; the web shows i18n text for each. */
export const PHOTO_ISSUES = {
  notBase64: 'photo_not_base64',
  sizeMismatch: 'photo_size_mismatch',
  notJpeg: 'photo_not_jpeg',
  fixed: 'photo_is_fixed',
} as const;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** Every JPEG starts FF D8 FF, which base64 writes as "/9j/". */
const JPEG_BASE64_START = '/9j/';

/** How many bytes a base64 text decodes to (the text is a multiple of 4 characters long). */
export function base64ByteLength(text: string): number {
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  return (text.length / 4) * 3 - padding;
}

const imageFields = z.object({
  contentType: z.literal('image/jpeg'),
  width: z
    .int()
    .min(1)
    .max(PHOTO_MAX_SIDE * 3),
  height: z
    .int()
    .min(1)
    .max(PHOTO_MAX_SIDE * 3),
  byteLength: z.int().min(1).max(PHOTO_LIMIT_BYTES),
  /** The JPEG, base64. */
  data: z
    .string()
    .min(8)
    .max(Math.ceil(PHOTO_LIMIT_BYTES / 3) * 4)
    .regex(BASE64, PHOTO_ISSUES.notBase64),
});

function imageRules(
  image: Pick<z.output<typeof imageFields>, 'data' | 'byteLength'>,
  context: z.RefinementCtx,
): void {
  if (image.data.length % 4 !== 0 || base64ByteLength(image.data) !== image.byteLength) {
    context.addIssue({ code: 'custom', path: ['byteLength'], message: PHOTO_ISSUES.sizeMismatch });
  }
  if (!image.data.startsWith(JPEG_BASE64_START)) {
    context.addIssue({ code: 'custom', path: ['data'], message: PHOTO_ISSUES.notJpeg });
  }
}

/** What a device builds a photo from: the picture, before it gets its record fields. */
export const photoImageSchema = imageFields.superRefine(imageRules);
export type PhotoImage = z.output<typeof photoImageSchema>;

/**
 * A picture of a colour, shown on its POS tile and in the lists. The device shrinks what the
 * owner picks to a small JPEG before saving it, so the bytes travel inside the record, base64,
 * like any other field (ADR 0009). A photo is never edited: a new one is created and the old one
 * voided. The colour shows its newest live photo.
 */
export const photoSchema = recordBaseSchema
  .extend({ variantId: idSchema, ...imageFields.shape })
  .superRefine(imageRules);
export type Photo = z.output<typeof photoSchema>;

/** The photo a colour shows: its newest live one (null when it has none). */
export function currentPhotoOf<P extends Pick<Photo, 'id' | 'createdAt' | 'voidedAt'>>(
  photos: readonly P[],
): P | null {
  let current: P | null = null;
  for (const photo of photos) {
    if (photo.voidedAt !== null) continue;
    if (
      current === null ||
      photo.createdAt > current.createdAt ||
      (photo.createdAt === current.createdAt && photo.id > current.id)
    ) {
      current = photo;
    }
  }
  return current;
}
