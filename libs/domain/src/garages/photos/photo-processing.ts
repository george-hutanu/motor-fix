import { createHash } from 'node:crypto';

import {
  IMAGE_FORMATS,
  IMAGE_WIDTHS,
  IMMUTABLE,
  photoConfig,
  variantFile,
} from '@motor-fix/contracts';
import sharp, { type Sharp } from 'sharp';
import { rgbaToThumbHash } from 'thumbhash';

import { opened } from './decode';
import type { StorageService } from '../../storage/storage.service';

// One libvips thread per photo: the worker's concurrency sets how many
// photos share the cores.
sharp.concurrency(1);

const THUMB_PX = 400;
const DISPLAY_PX = 1600;
// ThumbHash encodes from at most 100 px a side.
const PREVIEW_PX = 100;
// The encoder settings the variants are sized and budgeted for.
const ENCODING = {
  avif: { effort: 4, quality: 50 },
  webp: { quality: 75 },
} as const;
const KEPT_FORMATS: Record<string, 'png' | 'webp'> = {
  png: 'png',
  webp: 'webp',
};

// The display copy and the thumbnail beside the original, and the responsive
// variants at an address fixed by the original's content, all stripped of
// every location and other metadata (sharp writes none unless asked). The
// thumbnail carries the original's size as seen upright, the variants' digest
// and a ThumbHash preview, so a read needs no other store; it is written last,
// as it is what marks the photo processed. A failed write removes what this
// run wrote and fails the job, which BullMQ retries.
export async function processPhoto(
  storage: StorageService,
  key: string,
): Promise<void> {
  // The photo was removed while its job waited.
  if ((await storage.metadataOf(key)) === null) return;
  const original = await storage.readObject(key);
  const { format, height, source, width } = await opened(
    original,
    photoConfig().maxInputPixels,
  );

  const fitted = (px: number) =>
    source().rotate().resize({
      fit: 'inside',
      height: px,
      width: px,
      withoutEnlargement: true,
    });
  const kept = KEPT_FORMATS[format ?? ''];
  const display = kept
    ? fitted(DISPLAY_PX).toFormat(kept)
    : fitted(DISPLAY_PX).jpeg();
  const digest = createHash('sha256')
    .update(key)
    .update(original)
    .digest('hex');
  const path = storage.variantPath(key, digest);

  const written: string[] = [];
  const put = async (
    target: string,
    body: Buffer,
    type: string,
    metadata?: Record<string, string>,
    cacheControl?: string,
  ) => {
    written.push(target);
    await storage.putObject(target, body, type, metadata, cacheControl);
  };
  try {
    await put(
      storage.derivedKey(key, 'display'),
      await display.toBuffer(),
      `image/${kept ?? 'jpeg'}`,
    );
    for (const px of IMAGE_WIDTHS) {
      for (const each of IMAGE_FORMATS) {
        await put(
          `${path}/${variantFile(px, each)}`,
          await source()
            .rotate()
            .resize({ width: px, withoutEnlargement: true })
            .toFormat(each, ENCODING[each])
            .toBuffer(),
          `image/${each}`,
          undefined,
          IMMUTABLE,
        );
      }
    }
    await put(
      storage.derivedKey(key, 'thumb'),
      await fitted(THUMB_PX).jpeg().toBuffer(),
      'image/jpeg',
      {
        digest,
        height: String(height),
        thumbhash: await preview(fitted(PREVIEW_PX)),
        width: String(width),
      },
    );
  } catch (error) {
    await Promise.allSettled(written.map((each) => storage.deleteObject(each)));
    throw error;
  }
  // Removed while it was processed: the copies go too, as nothing holds them.
  if ((await storage.metadataOf(key)) === null) {
    await storage.deleteWithCopies(key);
  }
}

async function preview(image: Sharp): Promise<string> {
  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return Buffer.from(rgbaToThumbHash(info.width, info.height, data)).toString(
    'base64',
  );
}
