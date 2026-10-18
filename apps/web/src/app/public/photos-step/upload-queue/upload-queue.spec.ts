import { deserialize, serialize } from 'node:v8';

// jsdom has no structuredClone, which IndexedDB needs to store a value.
globalThis.structuredClone ??= ((value: unknown) =>
  deserialize(serialize(value))) as typeof structuredClone;

import 'fake-indexeddb/auto';

import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { IDBFactory } from 'fake-indexeddb';

import { UploadQueue } from './upload-queue';

const DRAFT = '7c1f5d9e-2b44-4f0a-9a51-3d6e8c2b1f00';
const OTHER = '0f0e0d0c-0b0a-4908-8706-050403020100';

const photo = (name: string, bytes = [1, 2, 3]) =>
  new File([new Uint8Array(bytes)], name, { type: 'image/jpeg' });

// A fresh queue on the same browser store, as after a reload.
function reopen(platform = 'browser'): UploadQueue {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: PLATFORM_ID, useValue: platform }],
  });
  return TestBed.inject(UploadQueue);
}

const names = (entries: { file: File }[]) => entries.map((e) => e.file.name);

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => jest.restoreAllMocks());

describe('the browser queue of photos waiting to reach the draft', () => {
  // @traces 1191-FR-001
  it('keeps the photos of a draft in the order picked, across a reload', async () => {
    const queue = reopen();
    await queue.add(DRAFT, [photo('unu.jpg'), photo('doi.jpg')]);
    await queue.add(OTHER, [photo('altul.jpg')]);
    await queue.add(DRAFT, [photo('trei.jpg', [9, 8, 7, 6])]);

    const restored = await reopen().forDraft(DRAFT);

    expect(names(restored)).toEqual(['unu.jpg', 'doi.jpg', 'trei.jpg']);
    expect(restored.map((e) => e.draftId)).toEqual([DRAFT, DRAFT, DRAFT]);
    expect(restored[2]?.file.type).toBe('image/jpeg');
    expect(
      Array.from(new Uint8Array(await restored[2]!.file.arrayBuffer())),
    ).toEqual([9, 8, 7, 6]);
    expect(new Set(restored.map((e) => e.id)).size).toBe(3);
  });

  // @traces 1191-FR-001
  it('forgets a photo once removed, and keeps the others', async () => {
    const queue = reopen();
    const [first] = await queue.add(DRAFT, [
      photo('unu.jpg'),
      photo('doi.jpg'),
    ]);

    await queue.remove(first!.id);

    expect(names(await reopen().forDraft(DRAFT))).toEqual(['doi.jpg']);
  });

  // @traces 1191-FR-001
  it('remembers the incoming key of a landed upload, and a removal while its confirm is on its way', async () => {
    const queue = reopen();
    const [entry] = await queue.add(DRAFT, [photo('unu.jpg')]);

    await queue.update(entry!.id, { key: 'incoming/garage_photo/x' });
    expect((await reopen().forDraft(DRAFT))[0]?.key).toBe(
      'incoming/garage_photo/x',
    );

    const again = reopen();
    await again.update(entry!.id, { key: undefined, removed: true });
    const [read] = await reopen().forDraft(DRAFT);
    expect(read?.key).toBeUndefined();
    expect(read?.removed).toBe(true);
  });

  // @traces 1191-FR-001
  it('picks positions after the last one held, so a later pick drains later', async () => {
    const queue = reopen();
    await queue.add(DRAFT, [photo('unu.jpg'), photo('doi.jpg')]);
    const [later] = await reopen().add(DRAFT, [photo('trei.jpg')]);

    const all = await reopen().forDraft(DRAFT);
    expect(all.at(-1)?.id).toBe(later?.id);
    expect(all.map((e) => e.position)).toEqual(
      [...all.map((e) => e.position)].sort((a, b) => a - b),
    );
  });

  // @traces 1191-FR-001
  it('keeps both photos when two tabs of one draft pick at the same moment', async () => {
    reopen();
    const [tabA, tabB] = [0, 1].map(() =>
      TestBed.runInInjectionContext(() => new UploadQueue()),
    );

    const [[a], [b]] = await Promise.all([
      tabA!.add(DRAFT, [photo('din-a.jpg')]),
      tabB!.add(DRAFT, [photo('din-b.jpg')]),
    ]);

    expect(a?.id).not.toBe(b?.id);
    expect(names(await reopen().forDraft(DRAFT)).sort()).toEqual([
      'din-a.jpg',
      'din-b.jpg',
    ]);
  });

  // @traces 1191-FR-001
  it('gives up on a pick rather than trying positions without end', async () => {
    const queue = reopen();
    jest.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
      this: IDBObjectStore,
    ) {
      const request = {} as IDBRequest;
      queueMicrotask(() => {
        Object.defineProperty(request, 'error', {
          value: new DOMException('taken', 'ConstraintError'),
        });
        request.onerror?.(new Event('error'));
      });
      return request;
    });

    await expect(queue.add(DRAFT, [photo('unu.jpg')])).resolves.toEqual([]);
  });

  // @traces 1191-FR-001
  it('changes one photo without reading every photo of its draft', async () => {
    const queue = reopen();
    const [first] = await queue.add(DRAFT, [
      photo('unu.jpg'),
      photo('doi.jpg'),
    ]);
    const all = jest.spyOn(IDBIndex.prototype, 'getAll');

    await queue.update(first!.id, { key: 'incoming/k' });

    expect(all).not.toHaveBeenCalled();
    all.mockRestore();
    expect((await reopen().forDraft(DRAFT))[0]?.key).toBe('incoming/k');
  });

  // @traces 1191-FR-001
  it('keeps the photos in memory for the page when IndexedDB is missing, without throwing', async () => {
    const saved = globalThis.indexedDB;
    Reflect.deleteProperty(globalThis, 'indexedDB');
    try {
      const queue = reopen();
      const [first] = await queue.add(DRAFT, [
        photo('unu.jpg'),
        photo('doi.jpg'),
      ]);
      await queue.update(first!.id, { key: 'incoming/k' });

      const held = await queue.forDraft(DRAFT);
      expect(names(held)).toEqual(['unu.jpg', 'doi.jpg']);
      expect(held[0]?.key).toBe('incoming/k');

      await queue.remove(first!.id);
      expect(names(await queue.forDraft(DRAFT))).toEqual(['doi.jpg']);
    } finally {
      globalThis.indexedDB = saved;
    }
  });

  // @traces 1191-FR-001
  it('falls back to memory when IndexedDB refuses to open', async () => {
    jest.spyOn(globalThis.indexedDB, 'open').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    const queue = reopen();
    await queue.add(DRAFT, [photo('unu.jpg')]);

    expect(names(await queue.forDraft(DRAFT))).toEqual(['unu.jpg']);
  });

  it('holds nothing on the server render', async () => {
    const queue = reopen('server');

    await queue.add(DRAFT, [photo('unu.jpg')]);

    expect(names(await queue.forDraft(DRAFT))).toEqual(['unu.jpg']);
    expect(names(await reopen().forDraft(DRAFT))).toEqual([]);
  });
});
