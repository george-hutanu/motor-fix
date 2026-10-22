// Each app compiles this file through its imports, not the lib's include.
/// <reference path="./heic/heic.d.ts" />
// sharp's prebuilt libvips has no HEVC decoder, so it cannot read a HEIC.
import { createHash } from 'node:crypto';

import {
  IMAGE_FORMATS,
  IMAGE_WIDTHS,
  photoConfig,
  variantFile,
} from '@motor-fix/contracts';
import decode from 'heic-decode';
import sharp, { type Sharp } from 'sharp';
import { rgbaToThumbHash } from 'thumbhash';

import type { StorageService } from '../../storage/storage.service';

// One libvips thread per photo: the worker's concurrency sets how many
// photos share the cores.
sharp.concurrency(1);

const THUMB_PX = 400;
const DISPLAY_PX = 1600;
// ThumbHash encodes from at most 100 px a side.
const PREVIEW_PX = 100;
const IMMUTABLE = 'public, max-age=31536000, immutable';
const KEPT_FORMATS: Record<string, 'png' | 'webp'> = {
  png: 'png',
  webp: 'webp',
};

// The original as sharp input, with its size as seen upright. sharp's libvips
// reads a HEIC's header but cannot decode HEVC; the decoder hands over upright
// RGBA pixels instead, which sharp takes as raw input.
async function opened(original: Buffer, maxInputPixels: number) {
  const meta = await sharp(original).metadata();
  if ((meta.width ?? 0) * (meta.height ?? 0) > maxInputPixels) {
    throw new Error('Input image exceeds pixel limit');
  }
  if (meta.compression === 'hevc') {
    const { data, height, width } = await decode({ buffer: original });
    const pixels = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    return {
      format: 'jpeg',
      height,
      source: () => sharp(pixels, { raw: { channels: 4, height, width } }),
      width,
    };
  }
  const sideways = (meta.orientation ?? 1) >= 5;
  return {
    format: meta.format,
    height: sideways ? meta.width : meta.height,
    source: () => sharp(original),
    width: sideways ? meta.height : meta.width,
  };
}

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
  limits = { maxInputPixels: photoConfig().maxInputPixels },
): Promise<void> {
  // The photo was removed while its job waited.
  if ((await storage.metadataOf(key)) === null) return;
  const original = await storage.readObject(key);
  const { format, height, source, width } = await opened(
    original,
    limits.maxInputPixels,
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
            .toFormat(each)
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
