import { S3TestStore } from './s3-test-store';
import { StorageService } from './storage.service';

const KEY = 'garage_photo/7c1f5d9e-2b44-4f0a-9a51-3d6e8c2b1f00/photo-1';
const BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]);

describe('deleting a key with its copies, hostile cases', () => {
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

  beforeEach(() => {
    store.objects.clear();
    store.beforeDelete = undefined;
  });

  it('leaves a sibling whose key only starts with the same characters', async () => {
    store.put(KEY, BYTES, 'image/jpeg');
    store.put(`${KEY}0`, BYTES, 'image/jpeg');
    store.put(`${KEY}0.thumb`, BYTES, 'image/jpeg');

    await storage.deleteWithCopies(KEY);

    expect([...store.objects.keys()].sort()).toEqual([
      `${KEY}0`,
      `${KEY}0.thumb`,
    ]);
  });

  it('can be run twice in a row', async () => {
    store.put(KEY, BYTES, 'image/jpeg');
    store.put(`${KEY}.thumb`, BYTES, 'image/jpeg');

    await storage.deleteWithCopies(KEY);

    await expect(storage.deleteWithCopies(KEY)).resolves.toBeUndefined();
  });
});
