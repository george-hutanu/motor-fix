// @traces 333-FR-006 333-FR-007
import sharp from 'sharp';

import { ClipTooLong, convertClip } from './clip';
import { convertPhoto } from './photo';

vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

const png = (w: number, h: number) =>
  sharp({ create: { background: '#369', channels: 3, height: h, width: w } })
    .png()
    .toBuffer();

describe('converting a photo, hostile input', () => {
  it('refuses an empty buffer', async () => {
    await expect(convertPhoto(Buffer.alloc(0))).rejects.toThrow();
  });

  it('refuses text posing as a photo', async () => {
    await expect(
      convertPhoto(Buffer.from('not an image at all', 'utf8')),
    ).rejects.toThrow();
  });

  it('refuses a UTF-16 text file with a byte order mark', async () => {
    await expect(
      convertPhoto(Buffer.from('﻿hello', 'utf16le')),
    ).rejects.toThrow();
  });

  it('refuses a truncated JPEG', async () => {
    const full = await sharp({
      create: { background: '#fff', channels: 3, height: 400, width: 400 },
    })
      .jpeg()
      .toBuffer();
    await expect(convertPhoto(full.subarray(0, 30))).rejects.toThrow();
  });

  it('refuses a video container', async () => {
    const mp4 = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from('ftypisom'),
      Buffer.alloc(40),
    ]);
    await expect(convertPhoto(mp4)).rejects.toThrow();
  });

  it('converts a 1 by 1 photo without enlarging it', async () => {
    const out = await convertPhoto(await png(1, 1));
    const meta = await sharp(out.file).metadata();
    expect([meta.width, meta.height]).toEqual([1, 1]);
    expect(meta.format).toBe('jpeg');
  });

  it('fits exactly 2048 px as is and 2049 px down to 2048', async () => {
    const at = await sharp(
      (await convertPhoto(await png(2048, 100))).file,
    ).metadata();
    const past = await sharp(
      (await convertPhoto(await png(2049, 100))).file,
    ).metadata();
    expect(at.width).toBe(2048);
    expect(past.width).toBe(2048);
  });

  it('fits a tall photo by its long side', async () => {
    const out = await convertPhoto(await png(1000, 5000));
    const file = await sharp(out.file).metadata();
    const thumb = await sharp(out.thumbnail).metadata();
    expect(file.height).toBe(2048);
    expect(thumb.height).toBe(480);
  });

  it('turns an EXIF-rotated photo upright', async () => {
    const rotated = await sharp({
      create: { background: '#c00', channels: 3, height: 100, width: 300 },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const meta = await sharp((await convertPhoto(rotated)).file).metadata();
    expect([meta.width, meta.height]).toEqual([100, 300]);
    expect(meta.orientation).toBeUndefined();
  });

  it('refuses an image past the pixel limit', async () => {
    const huge = await sharp({
      create: {
        background: '#000',
        channels: 3,
        height: 20_000,
        width: 20_000,
      },
      limitInputPixels: false,
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await expect(convertPhoto(huge)).rejects.toThrow();
  });

  it('is repeatable on the same input', async () => {
    const input = await png(800, 600);
    const a = await convertPhoto(input);
    const b = await convertPhoto(input);
    expect(a.file.equals(b.file)).toBe(true);
  });
});

describe('converting a clip, hostile input', () => {
  it('refuses an empty buffer', async () => {
    await expect(
      convertClip(Buffer.alloc(0), { maxSeconds: 60 }),
    ).rejects.toThrow();
  });

  it('refuses text posing as a clip, and not as too long', async () => {
    const error = await convertClip(Buffer.from('plain text'), {
      maxSeconds: 60,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ClipTooLong);
  });

  it('refuses a JPEG sent as a clip', async () => {
    const jpeg = await sharp({
      create: { background: '#fff', channels: 3, height: 10, width: 10 },
    })
      .jpeg()
      .toBuffer();
    await expect(convertClip(jpeg, { maxSeconds: 60 })).rejects.toThrow();
  });

  it('carries the length on ClipTooLong', () => {
    const error = new ClipTooLong(75);
    expect(error.seconds).toBe(75);
    expect(error.name).toBe('ClipTooLong');
  });
});
