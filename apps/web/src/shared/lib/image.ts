import { PHOTO_MAX_SIDE, PHOTO_TARGET_BYTES, type PhotoImage } from '@fabric/contracts';

/** Why a picked file could not be made into a photo. */
export class ImageError extends Error {
  constructor(readonly reason: 'unreadable' | 'too_large') {
    super(reason);
  }
}

/** The size an image is drawn at: its longest side at most `maxSide`, never enlarged. */
export function fitWithin(
  width: number,
  height: number,
  maxSide: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Tried in turn until the JPEG is small enough; then the picture itself is made smaller. */
const QUALITIES = [0.82, 0.72, 0.62, 0.5, 0.4] as const;
const SHRINK_STEPS = 3;

/** The picture as the browser decodes it (EXIF rotation applied), or an ImageError. */
async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    // An older browser, or a format createImageBitmap does not know: let an <img> try.
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return await createImageBitmap(image);
    } catch {
      throw new ImageError('unreadable');
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob?.type === 'image/jpeg') resolve(blob);
        else reject(new ImageError('unreadable'));
      },
      'image/jpeg',
      quality,
    );
  });
}

/** The bytes of a blob, base64 (without the `data:` prefix). */
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // readAsDataURL always gives a string: "data:image/jpeg;base64,<bytes>".
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => {
      reject(new ImageError('unreadable'));
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Makes a picked picture (a camera shot is several MB) into what a photo is (ADR 0009): a JPEG
 * whose longest side is at most PHOTO_MAX_SIDE and whose size is at most PHOTO_TARGET_BYTES, on
 * white (a transparent PNG would turn black). Needs a browser: it draws on a canvas.
 */
export async function compressImage(file: Blob): Promise<PhotoImage> {
  const bitmap = await decode(file);
  try {
    let side = PHOTO_MAX_SIDE;
    for (let step = 0; step < SHRINK_STEPS; step++) {
      const { width, height } = fitWithin(bitmap.width, bitmap.height, side);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new ImageError('unreadable');
      context.fillStyle = 'white';
      context.fillRect(0, 0, width, height);
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, width, height);
      for (const quality of QUALITIES) {
        const blob = await toJpeg(canvas, quality);
        if (blob.size <= PHOTO_TARGET_BYTES) {
          return {
            contentType: 'image/jpeg',
            width,
            height,
            byteLength: blob.size,
            data: await toBase64(blob),
          };
        }
      }
      side = Math.round(side * 0.75);
    }
    throw new ImageError('too_large');
  } finally {
    bitmap.close();
  }
}
