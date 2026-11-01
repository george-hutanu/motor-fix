import { Logger } from '@nestjs/common';
import type { MockInstance } from 'vitest';

import { GENERIC_FILES, MODEL_3D_FILES } from './models-3d';
import { Models3dStore } from './models-3d.store';
import type { StorageService } from '../../storage/storage.service';

// @traces 035-FR-007 035-FR-008 035-FR-011

const IMMUTABLE = 'public, max-age=31536000, immutable';

function memoryStorage(held: string[] = []) {
  const objects = new Map<
    string,
    { body: Uint8Array; type: string; cache?: string }
  >(
    held.map((key) => [
      key,
      { body: new Uint8Array([1]), type: 'model/gltf-binary' },
    ]),
  );
  const storage = {
    contentTypeOf: vi.fn(async (key: string) => objects.get(key)?.type ?? null),
    putObject: vi.fn(
      async (
        key: string,
        body: Uint8Array,
        type: string,
        _meta?: unknown,
        cache?: string,
      ) => {
        objects.set(key, { body, cache, type });
      },
    ),
  };
  return {
    objects,
    storage,
    store: new Models3dStore(storage as unknown as StorageService),
  };
}

let logs: MockInstance;
let errors: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  errors = vi
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('Models3dStore.fill', () => {
  it('writes all 26 catalogue files to an empty store as immutable GLBs', async () => {
    const { objects, store } = memoryStorage();

    expect(await store.fill()).toEqual({ written: 26 });

    expect(MODEL_3D_FILES).toHaveLength(26);
    for (const { file } of MODEL_3D_FILES) {
      const stored = objects.get(`models-3d/${file}`);
      expect([file, stored?.type, stored?.cache]).toEqual([
        file,
        'model/gltf-binary',
        IMMUTABLE,
      ]);
      expect(
        Buffer.from(stored?.body ?? [])
          .subarray(0, 4)
          .toString(),
      ).toBe('glTF');
    }
    expect(logs).toHaveBeenCalledWith('3D files uploaded: 26 written');
  });

  it('writes nothing the second time', async () => {
    const { storage, store } = memoryStorage();
    await store.fill();
    storage.putObject.mockClear();

    expect(await store.fill()).toEqual({ written: 0 });
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(logs).toHaveBeenLastCalledWith('3D files uploaded: 0 written');
  });

  it('never overwrites a key the store holds, and never generates when no generic shape is missing', async () => {
    const { objects, storage, store } = memoryStorage(
      Object.values(GENERIC_FILES).map((file) => `models-3d/${file}`),
    );

    expect(await store.fill()).toEqual({ written: 20 });
    for (const file of Object.values(GENERIC_FILES)) {
      expect(objects.get(`models-3d/${file}`)?.body).toEqual(
        new Uint8Array([1]),
      );
    }
    const written = storage.putObject.mock.calls.map(([key]) => key);
    expect(written.some((key) => key.includes('generic-'))).toBe(false);
  });

  it('logs a store failure as an error and returns the count so far', async () => {
    const { storage, store } = memoryStorage();
    let puts = 0;
    storage.putObject.mockImplementation(async () => {
      if (++puts > 3) throw new Error('store down');
    });

    expect(await store.fill()).toEqual({ written: 3 });
    expect(errors).toHaveBeenCalled();
  });
});
