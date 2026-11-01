import sharp from 'sharp';

import { convertPhoto } from './photo';
import { HEIC_BASE64 } from '../../garages/photos/heic/heic.fixture';

const located = (width: number, height: number) =>
  sharp({ create: { background: '#36c', channels: 3, height, width } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'Phone' },
      IFD3: { GPSLatitude: '44/1 25/1 0/1', GPSLatitudeRef: 'N' },
    })
    .toBuffer();

const plain = (format: 'png' | 'webp', width: number, height: number) =>
  sharp({ create: { background: '#c33', channels: 3, height, width } })
    .toFormat(format)
    .toBuffer();

vi.setConfig({ hookTimeout: 30_000, testTimeout: 30_000 });

// @traces 333-FR-006
describe('converting a job photo', () => {
  it('fits a large JPEG within 2048 px and a 480 px thumbnail, with no location left', async () => {
    const out = await convertPhoto(await located(4000, 3000));

    const file = await sharp(out.file).metadata();
    const thumb = await sharp(out.thumbnail).metadata();
    expect(file.format).toBe('jpeg');
    expect([file.width, file.height]).toEqual([2048, 1536]);
    expect(thumb.format).toBe('jpeg');
    expect(Math.max(thumb.width ?? 0, thumb.height ?? 0)).toBe(480);
    for (const meta of [file, thumb]) {
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
    }
  });

  it('never enlarges a small photo', async () => {
    const out = await convertPhoto(await located(300, 200));

    const file = await sharp(out.file).metadata();
    expect([file.width, file.height]).toEqual([300, 200]);
  });

  it.each(['png', 'webp'] as const)('converts a %s to JPEG', async (format) => {
    const out = await convertPhoto(await plain(format, 3000, 1000));

    const file = await sharp(out.file).metadata();
    expect(file.format).toBe('jpeg');
    expect(file.width).toBe(2048);
  });

  it('converts a HEIC from an iPhone', async () => {
    const out = await convertPhoto(Buffer.from(HEIC_BASE64, 'base64'));

    const file = await sharp(out.file).metadata();
    expect(file.format).toBe('jpeg');
    expect([file.width, file.height]).toEqual([16, 16]);
  });

  it('refuses a truncated photo', async () => {
    const whole = await located(800, 600);

    await expect(
      convertPhoto(whole.subarray(0, whole.length / 3)),
    ).rejects.toThrow();
  });
});
