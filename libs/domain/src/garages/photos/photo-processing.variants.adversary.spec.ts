import { createHash } from 'node:crypto';

import sharp from 'sharp';

import { HEIC_BASE64 } from './heic/heic.fixture';
import { processPhoto } from './photo-processing';
import { S3TestStore } from '../../storage/s3-test-store';
import { StorageService } from '../../storage/storage.service';

// @traces 1192-FR-001 1192-FR-002 1192-FR-003 1192-FR-004

const OWNER = '7c1f5d9e-2b44-4f0a-9a51-3d6e8c2b1f00';
const KEY = `garage_photo/${OWNER}/5e0a8f3b-91c2-4d7e-8b6a-0c4f2e9d1a37`;
const OTHER = `garage_photo/${OWNER}/0a0a0a0a-91c2-4d7e-8b6a-0c4f2e9d1a37`;

const digestOf = (key: string, bytes: Buffer) =>
  createHash('sha256').update(key).update(bytes).digest('hex');
const keysOf = (digest: string) =>
  [320, 640, 960, 1600].flatMap((w) => [
    `g/${OWNER}/${digest}/${w}.avif`,
    `g/${OWNER}/${digest}/${w}.webp`,
  ]);
const solid = (width: number, height: number, channels: 3 | 4 = 3) =>
  sharp({
    create: {
      background: channels === 4 ? '#33669955' : '#369',
      channels,
      height,
      width,
    },
  });
const variantKeysIn = (store: S3TestStore) =>
  [...store.objects.keys()].filter((k) => k.startsWith('g/')).sort();

describe('processing a photo into variants, hostile inputs', () => {
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
  afterEach(() => {
    delete process.env['PHOTO_MAX_INPUT_PIXELS'];
  });

  it('gives the same bytes under two keys two different variant paths', async () => {
    const bytes = await solid(800, 600).jpeg().toBuffer();
    store.put(KEY, bytes, 'image/jpeg');
    store.put(OTHER, bytes, 'image/jpeg');

    await processPhoto(storage, KEY);
    await processPhoto(storage, OTHER);

    expect(variantKeysIn(store)).toEqual(
      [
        ...keysOf(digestOf(KEY, bytes)),
        ...keysOf(digestOf(OTHER, bytes)),
      ].sort(),
    );
  }, 60_000);

  it('writes the same sixteen keys and no more when run twice', async () => {
    const bytes = await solid(800, 600).jpeg().toBuffer();
    store.put(KEY, bytes, 'image/jpeg');

    await processPhoto(storage, KEY);
    await processPhoto(storage, KEY);

    expect(variantKeysIn(store)).toEqual(keysOf(digestOf(KEY, bytes)).sort());
  }, 60_000);

  it('leaves no variant when the thumbnail write fails', async () => {
    store.put(KEY, await solid(800, 600).jpeg().toBuffer(), 'image/jpeg');
    const put = storage.putObject.bind(storage);
    const putting = vi
      .spyOn(storage, 'putObject')
      .mockImplementation(async (...args) => {
        if (args[0] === `${KEY}.thumb`) throw new Error('store down');
        return put(...args);
      });

    await expect(processPhoto(storage, KEY)).rejects.toThrow('store down');

    putting.mockRestore();
    expect(variantKeysIn(store)).toEqual([]);
    expect(store.objects.has(`${KEY}.thumb`)).toBe(false);
  }, 60_000);

  it('leaves no variant when the photo is removed while its variants are written', async () => {
    store.put(KEY, await solid(800, 600).jpeg().toBuffer(), 'image/jpeg');
    const put = storage.putObject.bind(storage);
    let first = true;
    const putting = vi
      .spyOn(storage, 'putObject')
      .mockImplementation(async (...args) => {
        const done = await put(...args);
        if (first) {
          first = false;
          store.objects.delete(KEY);
        }
        return done;
      });

    await processPhoto(storage, KEY).catch(() => undefined);

    putting.mockRestore();
    expect(variantKeysIn(store)).toEqual([]);
  }, 60_000);

  it('writes no variant when the pixel limit refuses the photo', async () => {
    store.put(KEY, await solid(100, 100).jpeg().toBuffer(), 'image/jpeg');

    process.env['PHOTO_MAX_INPUT_PIXELS'] = '9999';

    await expect(processPhoto(storage, KEY)).rejects.toThrow();

    expect([...store.objects.keys()]).toEqual([KEY]);
  });

  it('accepts a photo of exactly the pixel limit', async () => {
    const bytes = await solid(100, 100).jpeg().toBuffer();
    store.put(KEY, bytes, 'image/jpeg');

    process.env['PHOTO_MAX_INPUT_PIXELS'] = '10000';

    await processPhoto(storage, KEY);

    expect(variantKeysIn(store)).toEqual(keysOf(digestOf(KEY, bytes)).sort());
  }, 60_000);

  it.each([
    [959, [320, 320, 640, 640, 959, 959, 959, 959]],
    [960, [320, 320, 640, 640, 960, 960, 960, 960]],
    [1601, [320, 320, 640, 640, 960, 960, 1600, 1600]],
  ])(
    'caps the widths of a photo %i px wide at its own width',
    async (width, expected) => {
      const bytes = await solid(width, 10).jpeg().toBuffer();
      store.put(KEY, bytes, 'image/jpeg');

      await processPhoto(storage, KEY);

      const widths = await Promise.all(
        keysOf(digestOf(KEY, bytes)).map(
          async (k) =>
            (await sharp(store.objects.get(k)?.body).metadata()).width,
        ),
      );
      expect(widths).toEqual(expected);
    },
    60_000,
  );

  it('keeps every variant of a one pixel photo at one pixel', async () => {
    const bytes = await solid(1, 1).png().toBuffer();
    store.put(KEY, bytes, 'image/png');

    await processPhoto(storage, KEY);

    const sizes = await Promise.all(
      keysOf(digestOf(KEY, bytes)).map(async (k) => {
        const m = await sharp(store.objects.get(k)?.body).metadata();
        return `${m.width}x${m.height}`;
      }),
    );
    expect(new Set(sizes)).toEqual(new Set(['1x1']));
  }, 60_000);

  it('keeps every variant of a 4000 by 2 strip at least one pixel high', async () => {
    const bytes = await solid(4000, 2).jpeg().toBuffer();
    store.put(KEY, bytes, 'image/jpeg');

    await processPhoto(storage, KEY);

    const heights = await Promise.all(
      keysOf(digestOf(KEY, bytes)).map(
        async (k) =>
          (await sharp(store.objects.get(k)?.body).metadata()).height,
      ),
    );
    expect(heights.every((h) => (h ?? 0) >= 1)).toBe(true);
  }, 60_000);

  it('records a ThumbHash for a transparent PNG and variants that decode', async () => {
    const bytes = await solid(300, 200, 4).png().toBuffer();
    store.put(KEY, bytes, 'image/png');

    await processPhoto(storage, KEY);

    const meta = await storage.metadataOf(`${KEY}.thumb`);
    expect(meta?.['thumbhash']).toMatch(/^[A-Za-z0-9+/]{8,64}={0,2}$/);
    expect(meta?.['digest']).toBe(digestOf(KEY, bytes));
    const first = store.objects.get(keysOf(digestOf(KEY, bytes))[0] ?? '');
    expect((await sharp(first?.body).metadata()).width).toBe(300);
  }, 60_000);

  it('makes variants of a grayscale JPEG', async () => {
    const bytes = await solid(700, 500).greyscale().jpeg().toBuffer();
    store.put(KEY, bytes, 'image/jpeg');

    await processPhoto(storage, KEY);

    expect(variantKeysIn(store)).toEqual(keysOf(digestOf(KEY, bytes)).sort());
  }, 60_000);

  it('makes eight variants of a HEIC original, upright, from the original bytes', async () => {
    const bytes = Buffer.from(HEIC_BASE64, 'base64');
    store.put(KEY, bytes, 'image/heic');

    await processPhoto(storage, KEY);

    expect(variantKeysIn(store)).toEqual(keysOf(digestOf(KEY, bytes)).sort());
    for (const k of keysOf(digestOf(KEY, bytes))) {
      const m = await sharp(store.objects.get(k)?.body).metadata();
      expect([k, m.exif, m.xmp, m.iptc]).toEqual([
        k,
        undefined,
        undefined,
        undefined,
      ]);
    }
  }, 60_000);

  it('writes no variant for a photo with no thumbnail yet when the original is unreadable', async () => {
    store.put(KEY, Buffer.from('caf\xe9', 'latin1'), 'image/jpeg');

    await expect(processPhoto(storage, KEY)).rejects.toThrow();

    expect(variantKeysIn(store)).toEqual([]);
  });

  it('ends without writing when the original is gone', async () => {
    await processPhoto(storage, KEY);

    expect([...store.objects.keys()]).toEqual([]);
  });

  it('keeps the thumbnail ThumbHash short enough for object metadata', async () => {
    const bytes = await solid(3000, 2000).jpeg().toBuffer();
    store.put(KEY, bytes, 'image/jpeg');

    await processPhoto(storage, KEY);

    const meta = await storage.metadataOf(`${KEY}.thumb`);
    expect(
      Buffer.from(meta?.['thumbhash'] ?? '', 'base64').length,
    ).toBeLessThanOrEqual(25);
  }, 60_000);
});
