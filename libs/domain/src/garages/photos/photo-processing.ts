// Each app compiles this file through its imports, not the lib's include.
/// <reference path="./heic/heic.d.ts" />
// sharp's prebuilt libvips has no HEVC decoder, so it cannot read a HEIC.
import decode from 'heic-decode';
import sharp from 'sharp';

import type { StorageService } from '../../storage/storage.service';

const THUMB_PX = 400;
const DISPLAY_PX = 1600;
const KEPT_FORMATS: Record<string, 'png' | 'webp'> = {
  png: 'png',
  webp: 'webp',
};

// The original as sharp input, with its size as seen upright. sharp's libvips
// reads a HEIC's header but cannot decode HEVC; the decoder hands over upright
// RGBA pixels instead, which sharp takes as raw input.
async function opened(original: Buffer) {
  const meta = await sharp(original).metadata();
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

// Two copies beside the original, both stripped of every location and other
// metadata (sharp writes none unless asked). The thumbnail carries the
// original's size, as seen upright, so a read needs no other store.
export async function processPhoto(
  storage: StorageService,
  key: string,
): Promise<void> {
  // The photo was removed while its job waited.
  if ((await storage.metadataOf(key)) === null) return;
  const original = await storage.readObject(key);
  const { format, height, source, width } = await opened(original);

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

  await storage.putObject(
    storage.derivedKey(key, 'display'),
    await display.toBuffer(),
    `image/${kept ?? 'jpeg'}`,
  );
  await storage.putObject(
    storage.derivedKey(key, 'thumb'),
    await fitted(THUMB_PX).jpeg().toBuffer(),
    'image/jpeg',
    { height: String(height), width: String(width) },
  );
  // Removed while it was processed: the copies go too, as nothing holds them.
  if ((await storage.metadataOf(key)) === null) {
    await storage.deleteWithCopies(key);
  }
}
