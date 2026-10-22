// @traces 1192-photo-variants-FR-001 1192-photo-variants-FR-002
// @traces 1192-photo-variants-FR-003 1192-photo-variants-FR-011
import { createHash } from 'node:crypto';

import sharp from 'sharp';

import { HEIC_BASE64 } from './heic/heic.fixture';
import { processPhoto } from './photo-processing';
import { S3TestStore } from '../../storage/s3-test-store';
import { StorageService } from '../../storage/storage.service';

const KEY =
  'garage_photo/7c1f5d9e-2b44-4f0a-9a51-3d6e8c2b1f00/5e0a8f3b-91c2-4d7e-8b6a-0c4f2e9d1a37';

const located = (width: number, height: number) =>
  sharp({ create: { background: '#c33', channels: 3, height, width } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'Phone' },
      IFD3: { GPSLatitude: '44/1 25/1 0/1', GPSLatitudeRef: 'N' },
    })
    .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>')
    .toBuffer();

describe('processing a photo', () => {
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

  const copy = (name: 'thumb' | 'display') => {
    const object = store.objects.get(`${KEY}.${name}`);
    if (!object) throw new Error(`no ${name} copy`);
    return object;
  };

  it('starts from a fixture that carries location data', async () => {
    const meta = await sharp(await located(800, 600)).metadata();

    expect(meta.exif).toBeDefined();
    expect(meta.xmp).toBeDefined();
  });

  it('writes a thumbnail and a display copy with no location or other metadata', async () => {
    store.put(KEY, await located(2400, 1200), 'image/jpeg');

    await processPhoto(storage, KEY);

    for (const name of ['thumb', 'display'] as const) {
      const meta = await sharp(copy(name).body).metadata();
      expect([name, meta.exif, meta.xmp, meta.iptc]).toEqual([
        name,
        undefined,
        undefined,
        undefined,
      ]);
    }
  });

  it('makes the thumbnail at most 400 px and the display copy at most 1,600 px on the long side', async () => {
    store.put(KEY, await located(2400, 1200), 'image/jpeg');

    await processPhoto(storage, KEY);

    const thumb = await sharp(copy('thumb').body).metadata();
    const display = await sharp(copy('display').body).metadata();
    expect([thumb.format, thumb.width, thumb.height]).toEqual([
      'jpeg',
      400,
      200,
    ]);
    expect([display.format, display.width, display.height]).toEqual([
      'jpeg',
      1600,
      800,
    ]);
    expect(copy('thumb').contentType).toBe('image/jpeg');
  });

  it('never enlarges a small photo', async () => {
    store.put(KEY, await located(300, 200), 'image/jpeg');

    await processPhoto(storage, KEY);

    const display = await sharp(copy('display').body).metadata();
    expect([display.width, display.height]).toEqual([300, 200]);
  });

  it('records the width and height of the upright original on the thumbnail', async () => {
    const turned = await sharp({
      create: { background: '#3c3', channels: 3, height: 800, width: 1200 },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    store.put(KEY, turned, 'image/jpeg');

    await processPhoto(storage, KEY);

    expect(await storage.metadataOf(`${KEY}.thumb`)).toEqual(
      expect.objectContaining({ height: '1200', width: '800' }),
    );
  });

  it('keeps a PNG display copy in PNG and makes its thumbnail a JPEG', async () => {
    const png = await sharp({
      create: { background: '#33c', channels: 3, height: 1000, width: 2000 },
    })
      .png()
      .toBuffer();
    store.put(KEY, png, 'image/png');

    await processPhoto(storage, KEY);

    expect((await sharp(copy('display').body).metadata()).format).toBe('png');
    expect(copy('display').contentType).toBe('image/png');
    expect((await sharp(copy('thumb').body).metadata()).format).toBe('jpeg');
  });

  // @traces 1191-FR-005
  it('decodes a HEIC original into a JPEG thumbnail and a JPEG display copy with no metadata', async () => {
    const heic = Buffer.from(HEIC_BASE64, 'base64');
    expect((await sharp(heic).metadata()).exif).toBeDefined();
    store.put(KEY, heic, 'image/heic');

    await processPhoto(storage, KEY);

    for (const name of ['thumb', 'display'] as const) {
      const meta = await sharp(copy(name).body).metadata();
      expect([
        name,
        meta.format,
        meta.width,
        meta.height,
        meta.exif,
        meta.xmp,
        copy(name).contentType,
      ]).toEqual([name, 'jpeg', 16, 16, undefined, undefined, 'image/jpeg']);
    }
    expect(await storage.metadataOf(`${KEY}.thumb`)).toEqual(
      expect.objectContaining({ height: '16', width: '16' }),
    );
  });

  // @traces 1191-FR-005
  it('refuses a HEIC that claims more pixels than sharp takes, before decoding it', async () => {
    const heic = Buffer.from(HEIC_BASE64, 'base64');
    // The image's spatial extent box: 20,000 px a side, 400 MP.
    const ispe = heic.indexOf('ispe');
    heic.writeUInt32BE(20_000, ispe + 8);
    heic.writeUInt32BE(20_000, ispe + 12);
    store.put(KEY, heic, 'image/heic');

    await expect(processPhoto(storage, KEY)).rejects.toThrow(/pixel limit/);

    expect([...store.objects.keys()]).toEqual([KEY]);
  });

  it('refuses a photo above the configured pixel limit and writes nothing', async () => {
    store.put(KEY, await located(200, 100), 'image/jpeg');

    await expect(
      processPhoto(storage, KEY, { maxInputPixels: 10_000 }),
    ).rejects.toThrow(/pixel limit/);

    expect([...store.objects.keys()]).toEqual([KEY]);
  });

  it('leaves the original untouched', async () => {
    const original = await located(2400, 1200);
    store.put(KEY, original, 'image/jpeg');

    await processPhoto(storage, KEY);

    expect(
      Buffer.compare(store.objects.get(KEY)?.body ?? Buffer.alloc(0), original),
    ).toBe(0);
  });

  it('ends without writing when the photo was removed meanwhile', async () => {
    await expect(processPhoto(storage, KEY)).resolves.toBeUndefined();

    expect(store.objects.size).toBe(0);
  });

  it('leaves no copy behind when the photo is removed while it is processed', async () => {
    store.put(KEY, await located(800, 600), 'image/jpeg');
    const put = storage.putObject.bind(storage);
    const putting = jest
      .spyOn(storage, 'putObject')
      .mockImplementationOnce(async (...args) => {
        store.objects.delete(KEY);
        return put(...args);
      });

    await processPhoto(storage, KEY);

    putting.mockRestore();
    expect([...store.objects.keys()]).toEqual([]);
  });

  describe('the responsive variants', () => {
    const OWNER = '7c1f5d9e-2b44-4f0a-9a51-3d6e8c2b1f00';
    const WIDTHS = [320, 640, 960, 1600];
    const digestOf = (bytes: Buffer) =>
      createHash('sha256').update(KEY).update(bytes).digest('hex');
    const variantKeys = (digest: string) =>
      WIDTHS.flatMap((w) => [
        `g/${OWNER}/${digest}/${w}.avif`,
        `g/${OWNER}/${digest}/${w}.webp`,
      ]);
    const variant = (key: string) => {
      const object = store.objects.get(key);
      if (!object) throw new Error(`no variant ${key}`);
      return object;
    };

    it('writes four widths in AVIF and WebP at an address fixed by the content', async () => {
      const original = await located(2400, 1200);
      store.put(KEY, original, 'image/jpeg');

      await processPhoto(storage, KEY);

      for (const key of variantKeys(digestOf(original))) {
        const object = variant(key);
        const meta = await sharp(object.body).metadata();
        const [width, format] = key.split('/').at(-1)?.split('.') ?? [];
        expect([
          key,
          meta.width,
          object.contentType,
          object.cacheControl,
        ]).toEqual([
          key,
          Number(width),
          `image/${format}`,
          'public, max-age=31536000, immutable',
        ]);
        expect(meta.format).toBe(format === 'avif' ? 'heif' : 'webp');
      }
    }, 30_000);

    it('never enlarges a narrow photo past its own width', async () => {
      const original = await located(500, 400);
      store.put(KEY, original, 'image/jpeg');

      await processPhoto(storage, KEY);

      const widths = await Promise.all(
        variantKeys(digestOf(original)).map(
          async (key) => (await sharp(variant(key).body).metadata()).width,
        ),
      );
      expect(widths).toEqual([320, 320, 500, 500, 500, 500, 500, 500]);
    });

    it('turns a sideways photo upright', async () => {
      const turned = await sharp({
        create: { background: '#3c3', channels: 3, height: 800, width: 1200 },
      })
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer();
      store.put(KEY, turned, 'image/jpeg');

      await processPhoto(storage, KEY);

      const meta = await sharp(
        variant(`g/${OWNER}/${digestOf(turned)}/1600.webp`).body,
      ).metadata();
      expect([meta.width, meta.height, meta.orientation]).toEqual([
        800,
        1200,
        undefined,
      ]);
    });

    it('carries no location or other metadata in any variant', async () => {
      const original = await located(1200, 900);
      store.put(KEY, original, 'image/jpeg');

      await processPhoto(storage, KEY);

      for (const key of variantKeys(digestOf(original))) {
        const object = variant(key);
        const meta = await sharp(object.body).metadata();
        expect([key, meta.exif, meta.xmp, meta.iptc, object.metadata]).toEqual([
          key,
          undefined,
          undefined,
          undefined,
          {},
        ]);
      }
    });

    it('writes the thumbnail last, naming the digest and a ThumbHash preview', async () => {
      const original = await located(1200, 900);
      store.put(KEY, original, 'image/jpeg');
      const written: string[] = [];
      const put = storage.putObject.bind(storage);
      const putting = jest
        .spyOn(storage, 'putObject')
        .mockImplementation(async (...args) => {
          written.push(args[0]);
          return put(...args);
        });

      await processPhoto(storage, KEY);

      putting.mockRestore();
      expect(written.at(-1)).toBe(`${KEY}.thumb`);
      expect(written.slice(0, -1).sort()).toEqual(
        [...variantKeys(digestOf(original)), `${KEY}.display`].sort(),
      );
      const meta = await storage.metadataOf(`${KEY}.thumb`);
      expect(meta).toEqual({
        digest: digestOf(original),
        height: '900',
        thumbhash: expect.stringMatching(/^[A-Za-z0-9+/]{8,64}={0,2}$/),
        width: '1200',
      });
      expect(meta?.['thumbhash']?.length).toBeLessThanOrEqual(64);
    });

    it('removes the variants it wrote when a later write fails, and fails', async () => {
      store.put(KEY, await located(1200, 900), 'image/jpeg');
      const put = storage.putObject.bind(storage);
      let writes = 0;
      const putting = jest
        .spyOn(storage, 'putObject')
        .mockImplementation(async (...args) => {
          writes += 1;
          if (writes === 4) throw new Error('store down');
          return put(...args);
        });

      await expect(processPhoto(storage, KEY)).rejects.toThrow('store down');

      putting.mockRestore();
      expect([...store.objects.keys()]).toEqual([KEY]);
    });
  });
});
