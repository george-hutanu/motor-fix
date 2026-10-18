// @traces 1191-FR-001
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

const photo = (
  name: string,
  bytes: number[] = [1, 2, 3],
  type = 'image/jpeg',
) => new File([new Uint8Array(bytes)], name, { type });

function open(platform = 'browser'): UploadQueue {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: PLATFORM_ID, useValue: platform }],
  });
  return TestBed.inject(UploadQueue);
}

const names = (entries: { file: File }[]) => entries.map((e) => e.file.name);
const bytesOf = async (file: File) =>
  Array.from(new Uint8Array(await file.arrayBuffer()));

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('the upload queue against hostile use', () => {
  it('answers an empty add with nothing and leaves the draft empty', async () => {
    const queue = open();

    expect(await queue.add(DRAFT, [])).toEqual([]);
    expect(await queue.forDraft(DRAFT)).toEqual([]);
  });

  it('answers a draft it never saw with an empty list', async () => {
    expect(await open().forDraft('no-such-draft')).toEqual([]);
  });

  it('numbers concurrent adds without a clash, in call order', async () => {
    const queue = open();

    await Promise.all([
      queue.add(DRAFT, [photo('a.jpg'), photo('b.jpg')]),
      queue.add(DRAFT, [photo('c.jpg')]),
      queue.add(DRAFT, [photo('d.jpg'), photo('e.jpg')]),
    ]);

    const held = await queue.forDraft(DRAFT);
    expect(names(held)).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg']);
    expect(new Set(held.map((e) => e.id)).size).toBe(5);
    expect(held.map((e) => e.position)).toEqual([0, 1, 2, 3, 4]);
  });

  it('keeps picking order past ten entries, not text order of the ids', async () => {
    const queue = open();

    await queue.add(
      DRAFT,
      Array.from({ length: 12 }, (_, i) => photo(`p${i}.jpg`)),
    );

    expect(names(await open().forDraft(DRAFT))).toEqual(
      Array.from({ length: 12 }, (_, i) => `p${i}.jpg`),
    );
  });

  it('never gives a new photo the place of one still waiting, after an earlier one was removed', async () => {
    const queue = open();
    const [first] = await queue.add(DRAFT, [photo('a.jpg'), photo('b.jpg')]);
    await queue.remove(first!.id);

    const [added] = await queue.add(DRAFT, [photo('c.jpg')]);

    const held = await queue.forDraft(DRAFT);
    expect(names(held)).toEqual(['b.jpg', 'c.jpg']);
    expect(added!.id).not.toBe(held[0]!.id);
  });

  it('keeps one draft from reading another, even when one id is a prefix of the other', async () => {
    const queue = open();
    await queue.add('draft', [photo('a.jpg')]);
    await queue.add('draft/1', [photo('b.jpg')]);

    expect(names(await queue.forDraft('draft'))).toEqual(['a.jpg']);
    expect(names(await queue.forDraft('draft/1'))).toEqual(['b.jpg']);
  });

  it('updates the entry of a draft whose id contains slashes', async () => {
    const queue = open();
    const [entry] = await queue.add('a/b/c', [photo('a.jpg')]);

    await queue.update(entry!.id, { key: 'incoming/x' });

    expect((await queue.forDraft('a/b/c'))[0]?.key).toBe('incoming/x');
  });

  it('creates nothing when it updates an id it does not hold', async () => {
    const queue = open();

    await queue.update(`${DRAFT}/7`, { key: 'incoming/x' });
    await queue.update('no-slash-at-all', { removed: true });

    expect(await queue.forDraft(DRAFT)).toEqual([]);
  });

  it('removes an id it does not hold without throwing', async () => {
    const queue = open();
    await queue.add(DRAFT, [photo('a.jpg')]);

    await expect(queue.remove(`${DRAFT}/9`)).resolves.toBeUndefined();

    expect(names(await queue.forDraft(DRAFT))).toEqual(['a.jpg']);
  });

  it('keeps the removal mark and the key across a reload, and clears a key on request', async () => {
    const queue = open();
    const [entry] = await queue.add(DRAFT, [photo('a.jpg')]);
    await queue.update(entry!.id, { key: 'incoming/x', removed: true });

    const [back] = await open().forDraft(DRAFT);
    expect(back).toMatchObject({ key: 'incoming/x', removed: true });

    await open().update(entry!.id, { key: undefined });
    const [cleared] = await open().forDraft(DRAFT);
    expect(cleared?.key).toBeUndefined();
    expect(cleared?.removed).toBe(true);
  });

  it('keeps the exact bytes, name and type of a file with a unicode name and no extension', async () => {
    const queue = open();
    const bytes = [0xff, 0xd8, 0xff, 0x00, 0x80, 0xfe];
    await queue.add(DRAFT, [photo('fotografie-ă-ț-😀', bytes, 'image/heic')]);

    const [back] = await open().forDraft(DRAFT);

    expect(back?.file.name).toBe('fotografie-ă-ț-😀');
    expect(back?.file.type).toBe('image/heic');
    expect(await bytesOf(back!.file)).toEqual(bytes);
  });

  it('holds an empty file as an empty file', async () => {
    const queue = open();
    await queue.add(DRAFT, [photo('gol.jpg', [])]);

    const [back] = await open().forDraft(DRAFT);

    expect(back?.file.size).toBe(0);
  });

  it('holds 60 photos and reads them back in order', async () => {
    const queue = open();
    await queue.add(
      DRAFT,
      Array.from({ length: 60 }, (_, i) => photo(`p${i}.jpg`, [i & 0xff])),
    );

    const held = await open().forDraft(DRAFT);

    expect(held).toHaveLength(60);
    expect(held[59]?.file.name).toBe('p59.jpg');
    expect(held.map((e) => e.position)).toEqual(
      Array.from({ length: 60 }, (_, i) => i),
    );
  });

  it('falls back to memory without an error when the store cannot be opened', async () => {
    globalThis.indexedDB = {
      open: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    } as unknown as IDBFactory;
    const queue = open();

    await queue.add(DRAFT, [photo('a.jpg'), photo('b.jpg')]);
    await queue.add(OTHER, [photo('z.jpg')]);

    expect(names(await queue.forDraft(DRAFT))).toEqual(['a.jpg', 'b.jpg']);
    await queue.remove((await queue.forDraft(DRAFT))[0]!.id);
    expect(names(await queue.forDraft(DRAFT))).toEqual(['b.jpg']);
  });

  it('falls back to memory when the store opens with an error event', async () => {
    globalThis.indexedDB = {
      open: () => {
        const request: Record<string, unknown> = {};
        queueMicrotask(() => (request['onerror'] as () => void)());
        return request;
      },
    } as unknown as IDBFactory;
    const queue = open();

    await queue.add(DRAFT, [photo('a.jpg')]);

    expect(names(await queue.forDraft(DRAFT))).toEqual(['a.jpg']);
  });

  it('keeps the photo in memory when the browser store refuses the write', async () => {
    const queue = open();
    await queue.forDraft(DRAFT);
    const put = jest
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });
    try {
      await queue.add(DRAFT, [photo('a.jpg')]);
    } finally {
      put.mockRestore();
    }

    expect(names(await queue.forDraft(DRAFT))).toEqual(['a.jpg']);
  });

  it('uses memory only on the server and never touches indexedDB', async () => {
    const opened = jest.fn();
    globalThis.indexedDB = { open: opened } as unknown as IDBFactory;
    const queue = open('server');

    await queue.add(DRAFT, [photo('a.jpg')]);

    expect(opened).not.toHaveBeenCalled();
    expect(names(await queue.forDraft(DRAFT))).toEqual(['a.jpg']);
  });
});
