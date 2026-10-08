import sharp from 'sharp';

import { processPhoto } from './photo-processing';
import { S3TestStore } from '../../storage/s3-test-store';
import { StorageService } from '../../storage/storage.service';

const KEY =
  'garage_photo/7c1f5d9e-2b44-4f0a-9a51-3d6e8c2b1f00/5e0a8f3b-91c2-4d7e-8b6a-0c4f2e9d1a37';

const solid = (width: number, height: number) =>
  sharp({ create: { background: '#369', channels: 3, height, width } });

describe('processing a photo, hostile inputs', () => {
  const store = new S3TestStore();
  let storage: StorageService;

  beforeAll(async () => {
    await store.start();
    storage = new StorageService(store.env());
  });

  afterAll(async () => {
    storage.onApplicationShutdown();
    await store.stop();
  });

  beforeEach(() => store.objects.clear());

  it.each([
    ['an empty object', Buffer.alloc(0)],
    ['plain text', Buffer.from('not a photo at all')],
    ['UTF-16 text with a byte order mark', Buffer.from('﻿hello', 'utf16le')],
    ['a Latin-1 text file', Buffer.from('caf\xe9 \xfc', 'latin1')],
    [
      'random binary',
      Buffer.from(Array.from({ length: 512 }, (_, i) => (i * 37) % 256)),
    ],
  ])('rejects %s and writes no copy', async (_, bytes) => {
    store.put(KEY, bytes, 'image/jpeg');

    await expect(processPhoto(storage, KEY)).rejects.toThrow();

    expect([...store.objects.keys()]).toEqual([KEY]);
  });

  it('rejects a truncated JPEG without leaving a half-written copy', async () => {
    const whole = await solid(1200, 800).jpeg().toBuffer();
    store.put(KEY, whole.subarray(0, 100), 'image/jpeg');

    await expect(processPhoto(storage, KEY)).rejects.toThrow();

    expect(store.objects.has(`${KEY}.thumb`)).toBe(false);
    expect(store.objects.has(`${KEY}.display`)).toBe(false);
  });

  it('keeps a one pixel photo at one pixel and records 1 by 1', async () => {
    store.put(KEY, await solid(1, 1).jpeg().toBuffer(), 'image/jpeg');

    await processPhoto(storage, KEY);

    expect(await storage.metadataOf(`${KEY}.thumb`)).toEqual({
      height: '1',
      width: '1',
    });
  });

  it('keeps a very wide strip at least one pixel high', async () => {
    store.put(KEY, await solid(4000, 4).jpeg().toBuffer(), 'image/jpeg');

    await processPhoto(storage, KEY);

    const thumb = await sharp(
      store.objects.get(`${KEY}.thumb`)?.body,
    ).metadata();
    expect([thumb.width, thumb.height]).toEqual([400, 1]);
  });

  it('stops at exactly 400 and 1,600 on a photo of exactly those sizes', async () => {
    store.put(KEY, await solid(1600, 400).jpeg().toBuffer(), 'image/jpeg');

    await processPhoto(storage, KEY);

    const display = await sharp(
      store.objects.get(`${KEY}.display`)?.body,
    ).metadata();
    const thumb = await sharp(
      store.objects.get(`${KEY}.thumb`)?.body,
    ).metadata();
    expect([display.width, display.height]).toEqual([1600, 400]);
    expect([thumb.width, thumb.height]).toEqual([400, 100]);
  });

  it('keeps a WebP display copy in WebP and makes its thumbnail a JPEG', async () => {
    store.put(KEY, await solid(2000, 1000).webp().toBuffer(), 'image/webp');

    await processPhoto(storage, KEY);

    expect(
      (await sharp(store.objects.get(`${KEY}.display`)?.body).metadata())
        .format,
    ).toBe('webp');
    expect(
      (await sharp(store.objects.get(`${KEY}.thumb`)?.body).metadata()).format,
    ).toBe('jpeg');
  });

  it('turns a transparent PNG into a JPEG thumbnail that decodes', async () => {
    const png = await sharp({
      create: {
        background: { alpha: 0, b: 0, g: 0, r: 0 },
        channels: 4,
        height: 600,
        width: 900,
      },
    })
      .png()
      .toBuffer();
    store.put(KEY, png, 'image/png');

    await processPhoto(storage, KEY);

    const thumb = await sharp(
      store.objects.get(`${KEY}.thumb`)?.body,
    ).metadata();
    expect([thumb.format, thumb.width, thumb.height]).toEqual([
      'jpeg',
      400,
      267,
    ]);
  });

  it('strips the orientation tag after turning the pixels', async () => {
    const turned = await solid(1200, 800)
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    store.put(KEY, turned, 'image/jpeg');

    await processPhoto(storage, KEY);

    const display = await sharp(
      store.objects.get(`${KEY}.display`)?.body,
    ).metadata();
    expect([display.width, display.height, display.orientation]).toEqual([
      800,
      1200,
      undefined,
    ]);
  });

  it('gives the same copies when run twice on the same original', async () => {
    store.put(KEY, await solid(2400, 1200).jpeg().toBuffer(), 'image/jpeg');

    await processPhoto(storage, KEY);
    const first = Buffer.from(store.objects.get(`${KEY}.thumb`)?.body ?? []);
    await processPhoto(storage, KEY);

    expect(
      Buffer.compare(
        first,
        store.objects.get(`${KEY}.thumb`)?.body ?? Buffer.alloc(0),
      ),
    ).toBe(0);
    expect(store.objects.size).toBe(3);
  });

  it('processes a 24 megapixel photo within the limits', async () => {
    store.put(
      KEY,
      await solid(6000, 4000).jpeg({ quality: 40 }).toBuffer(),
      'image/jpeg',
    );

    await processPhoto(storage, KEY);

    const display = await sharp(
      store.objects.get(`${KEY}.display`)?.body,
    ).metadata();
    expect([display.width, display.height]).toEqual([1600, 1067]);
    expect(await storage.metadataOf(`${KEY}.thumb`)).toEqual({
      height: '4000',
      width: '6000',
    });
  }, 30_000);
});
