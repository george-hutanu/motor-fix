import { MEDIA_LIMITS } from '@motor-fix/contracts';

import { ClipTooLong, convertClip } from './clip';
import { convertPhoto } from './photo';
import type { StorageService } from '../../storage/storage.service';
import { recordConversion } from '../media.metrics';
import { type MediaDeps, markFailed, markVisible } from '../media.service';

export interface ProcessingDeps extends MediaDeps {
  storage: StorageService;
}

// Converts one uploaded item and shows it. An item no longer processing
// (removed, failed, or shown by an earlier try) is left alone. The copies
// sit beside the original, which the purge deletes with them.
export async function processMedia(
  deps: ProcessingDeps,
  mediaId: string,
): Promise<void> {
  const item = await deps.prisma.mediaItem.findUnique({
    where: { id: mediaId },
  });
  if (item?.status !== 'processing' || !item.originalKey) return;
  const { storage } = deps;
  const original = await storage.readObject(item.originalKey);
  const fileKey = storage.derivedKey(item.originalKey, 'display');
  const thumbnailKey = storage.derivedKey(item.originalKey, 'thumb');
  const started = performance.now();
  if (item.kind === 'photo') {
    const { file, thumbnail } = await convertPhoto(original);
    await storage.putObject(fileKey, file, 'image/jpeg');
    await storage.putObject(thumbnailKey, thumbnail, 'image/jpeg');
    recordConversion('photo', (performance.now() - started) / 1000);
    await markVisible(deps, mediaId, { fileKey, thumbnailKey });
    return;
  }
  // A kept recording has no length limit; a clip is held to its declared
  // 60 seconds. A clip too long is the sender's, not the platform's: the
  // item fails at once and the job ends well, so no alert fires on it.
  const converted = await convertClip(original, {
    maxSeconds: item.kind === 'clip' ? MEDIA_LIMITS.clipSeconds : undefined,
  }).catch((error: unknown) => {
    if (error instanceof ClipTooLong) return null;
    throw error;
  });
  if (!converted) {
    await markFailed(deps.prisma, mediaId);
    return;
  }
  await storage.putObject(fileKey, converted.file, 'video/mp4');
  await storage.putObject(thumbnailKey, converted.thumbnail, 'image/jpeg');
  recordConversion(item.kind, (performance.now() - started) / 1000);
  await markVisible(deps, mediaId, {
    fileKey,
    seconds: converted.seconds,
    thumbnailKey,
  });
}
