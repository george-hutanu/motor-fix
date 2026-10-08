import { Test } from '@nestjs/testing';

import { S3TestStore } from './s3-test-store';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

const KEY = 'garage_photo/7c1f5d9e-2b44-4f0a-9a51-3d6e8c2b1f00/photo-1';
const BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

describe('StorageService, a photo and its processed copies', () => {
  const store = new S3TestStore();
  let storage: StorageService;

  beforeAll(async () => {
    await store.start();
    const moduleRef = await Test.createTestingModule({
      imports: [StorageModule.register(store.env())],
    }).compile();
    storage = moduleRef.get(StorageService);
  });

  afterAll(() => store.stop());

  beforeEach(() => {
    store.objects.clear();
    store.beforeDelete = undefined;
  });

  it('names the copies beside the original', () => {
    expect(storage.derivedKey(KEY, 'thumb')).toBe(`${KEY}.thumb`);
    expect(storage.derivedKey(KEY, 'display')).toBe(`${KEY}.display`);
  });

  it('keeps the metadata an object is written with and answers it', async () => {
    await storage.putObject(`${KEY}.thumb`, BYTES, 'image/jpeg', {
      height: '900',
      width: '1200',
    });

    expect(await storage.metadataOf(`${KEY}.thumb`)).toEqual({
      height: '900',
      width: '1200',
    });
  });

  it('answers no metadata for an object that does not exist', async () => {
    expect(await storage.metadataOf(`${KEY}.thumb`)).toBeNull();
  });

  it('reads an object back whole', async () => {
    store.put(KEY, BYTES, 'image/jpeg');

    expect(Buffer.compare(await storage.readObject(KEY), BYTES)).toBe(0);
  });

  it('deletes a key together with its thumbnail and display copy', async () => {
    store.put(KEY, BYTES, 'image/jpeg');
    store.put(`${KEY}.thumb`, BYTES, 'image/jpeg');
    store.put(`${KEY}.display`, BYTES, 'image/jpeg');
    store.put('garage_photo/other/kept', BYTES, 'image/jpeg');

    await storage.deleteWithCopies(KEY);

    expect([...store.objects.keys()]).toEqual(['garage_photo/other/kept']);
  });

  it('succeeds when the copies were never made', async () => {
    store.put(KEY, BYTES, 'image/jpeg');

    await expect(storage.deleteWithCopies(KEY)).resolves.toBeUndefined();
    expect(store.objects.size).toBe(0);
  });

  it('succeeds when nothing is left at the key', async () => {
    await expect(storage.deleteWithCopies(KEY)).resolves.toBeUndefined();
  });

  it('fails when the store refuses a delete', async () => {
    store.put(KEY, BYTES, 'image/jpeg');
    store.beforeDelete = () => {
      throw new Error('store down');
    };

    await expect(storage.deleteWithCopies(KEY)).rejects.toThrow();
  });
});
