// A phone photo shrunk before it is sent: its long side to `longSide` pixels,
// upright, as a JPEG. Anything that stops the browser from doing so (no
// decoding or canvas API, a photo it cannot decode, a copy no smaller) sends
// the original instead.
export async function downscale(
  file: File,
  longSide = 2048,
  quality = 0.82,
): Promise<File> {
  if (
    typeof createImageBitmap !== 'function' ||
    typeof OffscreenCanvas !== 'function'
  ) {
    return file;
  }
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = longSide / Math.max(bitmap.width, bitmap.height);
    if (scale >= 1) return file;
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ quality, type: 'image/jpeg' });
    if (blob.size >= file.size) return file;
    const name = `${file.name.replace(/\.[^.]*$/, '')}.jpg`;
    return new File([blob], name, { type: 'image/jpeg' });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
