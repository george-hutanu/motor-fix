// Each app compiles this file through its imports, not the lib's include.
/// <reference path="./heic/heic.d.ts" />
// sharp's prebuilt libvips has no HEVC decoder, so it cannot read a HEIC.
import decode from 'heic-decode';
import sharp from 'sharp';

// The original as sharp input, with its size as seen upright. sharp's libvips
// reads a HEIC's header but cannot decode HEVC; the decoder hands over upright
// RGBA pixels instead, which sharp takes as raw input.
export async function opened(original: Buffer, maxInputPixels: number) {
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
