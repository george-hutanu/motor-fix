import sharp from 'sharp';

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

    expect(await storage.metadataOf(`${KEY}.thumb`)).toEqual({
      height: '1200',
      width: '800',
    });
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
});
