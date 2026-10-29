import { MEDIA_LIMITS, photoConfig } from '@motor-fix/contracts';

import { opened } from '../../garages/photos/decode';

// A job photo as the driver sees it: upright, its long side at most 2048 px,
// and a 480 px thumbnail, both JPEG. sharp writes no metadata unless asked,
// so no location or camera tag survives.
export async function convertPhoto(
  original: Buffer,
): Promise<{ file: Buffer; thumbnail: Buffer }> {
  const { source } = await opened(original, photoConfig().maxInputPixels);
  const fitted = (px: number) =>
    source()
      .rotate()
      .resize({
        fit: 'inside',
        height: px,
        width: px,
        withoutEnlargement: true,
      })
      .jpeg({ mozjpeg: true, quality: 80 });
  return {
    file: await fitted(MEDIA_LIMITS.photoPx).toBuffer(),
    thumbnail: await fitted(MEDIA_LIMITS.thumbPx).toBuffer(),
  };
}
