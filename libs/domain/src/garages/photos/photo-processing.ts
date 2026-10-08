import sharp from 'sharp';

import type { StorageService } from '../../storage/storage.service';

const THUMB_PX = 400;
const DISPLAY_PX = 1600;
const KEPT_FORMATS: Record<string, 'png' | 'webp'> = {
  png: 'png',
  webp: 'webp',
};

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
  const meta = await sharp(original).metadata();
  const sideways = (meta.orientation ?? 1) >= 5;
  const width = sideways ? meta.height : meta.width;
  const height = sideways ? meta.width : meta.height;

  const fitted = (px: number) =>
    sharp(original).rotate().resize({
      fit: 'inside',
      height: px,
      width: px,
      withoutEnlargement: true,
    });
  const kept = KEPT_FORMATS[meta.format ?? ''];
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
