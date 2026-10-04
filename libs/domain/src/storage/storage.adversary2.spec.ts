import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { S3TestStore } from './s3-test-store';
import { StorageModule } from './storage.module';
import { type SignedUpload, StorageService } from './storage.service';

type Purpose = Parameters<StorageService['createUpload']>[0];

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const PDF = Buffer.from('%PDF-1.7\n');
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0xff, 0xff, 0xff, 0x7f]),
  Buffer.from('WEBPVP8 '),
]);
const MB = 1024 * 1024;
const MINUTE = 60_000;
const ID = '00000000-0000-4000-8000-000000000000';

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpException);
  const http = error as HttpException;
  const body = http.getResponse() as { code?: string };
  return { code: body.code, status: http.getStatus() };
}

function send(upload: SignedUpload, file: Buffer) {
  const form = new FormData();
  for (const [name, value] of Object.entries(upload.fields))
    form.append(name, value);
  form.append('file', new Blob([new Uint8Array(file)]));
  return fetch(upload.url, { body: form, method: 'POST' });
}

describe('StorageService second round of hostile input', () => {
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
    store.now = () => Date.now();
    store.beforeCopy = undefined;
  });

  describe('confirming with a key that is not the caller incoming key', () => {
    it.each([
      ['an empty key', ''],
      ['the bare prefix', 'incoming/garage_photo/acc_1/'],
      ['the prefix without a slash', 'incoming/garage_photo/acc_1'],
      [
        'an owner whose id starts with the same letters',
        `incoming/garage_photo/acc_10/${ID}`,
      ],
      [
        'an owner whose id is a prefix of the caller',
        `incoming/garage_photo/acc_/${ID}`,
      ],
      [
        'a purpose that starts with the same letters',
        `incoming/garage_photo_x/acc_1/${ID}`,
      ],
      ['a final key', `garage_photo/acc_1/${ID}`],
      ['a leading slash', `/incoming/garage_photo/acc_1/${ID}`],
      ['a doubled slash', `incoming//garage_photo/acc_1/${ID}`],
      ['a different case', `INCOMING/garage_photo/acc_1/${ID}`],
    ])('answers file_missing for %s and leaves every object', async (_, key) => {
      store.put(key, JPEG, 'image/jpeg');
      const before = [...store.objects.keys()];

      expect(
        await refusal(storage.confirmUpload(key, 'garage_photo', 'acc_1')),
      ).toEqual({ code: 'file_missing', status: 409 });
      expect([...store.objects.keys()]).toEqual(before);
    });

    it('answers file_missing for an issued key confirmed as another purpose that takes the same type', async () => {
      const upload = await storage.createUpload(
        'garage_photo',
        'acc_1',
        'image/jpeg',
        JPEG.length,
      );
      await send(upload, JPEG);

      expect(
        await refusal(
          storage.confirmUpload(upload.key, 'mechanic_photo', 'acc_1'),
        ),
      ).toEqual({ code: 'file_missing', status: 409 });
      expect(store.objects.has(upload.key)).toBe(true);
    });
  });

  describe('signatures', () => {
    it.each([
      ['a JPEG as a garage photo', JPEG, 'image/jpeg', 'garage_photo'],
      ['a PNG as a message photo', PNG, 'image/png', 'message_photo'],
      [
        'a WebP with an enormous declared length as a mechanic photo',
        WEBP,
        'image/webp',
        'mechanic_photo',
      ],
      ['a PDF as a legal document', PDF, 'application/pdf', 'legal_document'],
      ['a PDF as a repair invoice', PDF, 'application/pdf', 'repair_invoice'],
      ['a PNG as a repair invoice', PNG, 'image/png', 'repair_invoice'],
      ['a JPEG as a legal document', JPEG, 'image/jpeg', 'legal_document'],
    ])('moves %s', async (_, body, type, purpose) => {
      const key = `incoming/${purpose}/acc_1/${ID}`;
      store.put(key, body, type);

      await expect(
        storage.confirmUpload(key, purpose as Purpose, 'acc_1'),
      ).resolves.toBe(`${purpose}/acc_1/${ID}`);
      expect(store.objects.get(`${purpose}/acc_1/${ID}`)?.body).toEqual(body);
      expect(store.objects.has(key)).toBe(false);
    });

    it.each([
      [
        'UTF-16 text with a byte order mark as a PDF',
        Buffer.from('﻿%PDF-1.7', 'utf16le'),
        'application/pdf',
      ],
      [
        'UTF-8 text with a byte order mark before the PDF signature',
        Buffer.from('﻿%PDF-1.7'),
        'application/pdf',
      ],
      [
        'Latin-1 text as a PNG',
        Buffer.from('Factură ñ', 'latin1'),
        'image/png',
      ],
      [
        'a JPEG signature cut to two bytes',
        Buffer.from([0xff, 0xd8]),
        'image/jpeg',
      ],
      [
        'a RIFF WebP cut before the form type ends',
        Buffer.concat([
          Buffer.from('RIFF'),
          Buffer.alloc(4),
          Buffer.from('WEB'),
        ]),
        'image/webp',
      ],
      [
        'a Windows executable as a JPEG',
        Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]),
        'image/jpeg',
      ],
      [
        'a gzip stream as a PDF',
        Buffer.from([0x1f, 0x8b, 8, 0]),
        'application/pdf',
      ],
      [
        'a PNG signature with a lowercase letter changed',
        Buffer.from([0x89, 0x70, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        'image/png',
      ],
    ])('deletes %s', async (_, body, type) => {
      const key = `incoming/legal_document/acc_1/${ID}`;
      store.put(key, body, type);

      expect(
        await refusal(storage.confirmUpload(key, 'legal_document', 'acc_1')),
      ).toEqual({ code: 'file_type_mismatch', status: 422 });
      expect(store.objects.size).toBe(0);
    });

    it('deletes an object of tens of megabytes as too large', async () => {
      const key = `incoming/garage_photo/acc_1/${ID}`;
      store.put(
        key,
        Buffer.concat([JPEG, Buffer.alloc(40 * MB)]),
        'image/jpeg',
      );

      expect(
        await refusal(storage.confirmUpload(key, 'garage_photo', 'acc_1')),
      ).toEqual({ code: 'file_too_large', status: 422 });
      expect(store.objects.size).toBe(0);
    });

    it('reports too large before a bad signature when an oversized object also has wrong bytes', async () => {
      const key = `incoming/garage_photo/acc_1/${ID}`;
      store.put(key, Buffer.alloc(11 * MB), 'image/jpeg');

      const answer = await refusal(
        storage.confirmUpload(key, 'garage_photo', 'acc_1'),
      );

      expect(answer.status).toBe(422);
      expect(store.objects.size).toBe(0);
    });
  });

  describe('many at once', () => {
    it('confirms thirty different uploads in parallel, each to its own final key', async () => {
      const uploads = await Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          storage.createUpload(
            'garage_photo',
            `acc_${i % 3}`,
            'image/jpeg',
            JPEG.length,
          ),
        ),
      );
      for (const u of uploads) expect((await send(u, JPEG)).status).toBe(204);

      const finals = await Promise.all(
        uploads.map((u, i) =>
          storage.confirmUpload(u.key, 'garage_photo', `acc_${i % 3}`),
        ),
      );

      expect(new Set(finals).size).toBe(30);
      expect([...store.objects.keys()].sort()).toEqual([...finals].sort());
    });

    it('confirms the same key owned by two owners only for its own owner', async () => {
      const upload = await storage.createUpload(
        'garage_photo',
        'acc_1',
        'image/jpeg',
        JPEG.length,
      );
      await send(upload, JPEG);

      const [other, own] = await Promise.allSettled([
        storage.confirmUpload(upload.key, 'garage_photo', 'acc_2'),
        storage.confirmUpload(upload.key, 'garage_photo', 'acc_1'),
      ]);

      expect(other.status).toBe('rejected');
      expect(own).toEqual({
        status: 'fulfilled',
        value: upload.key.replace('incoming/', ''),
      });
    });
  });

  describe('the upload form', () => {
    it('expires about 15 minutes after it was asked for', async () => {
      const before = Date.now();
      const upload = await storage.createUpload(
        'garage_photo',
        'acc_1',
        'image/jpeg',
        5,
      );

      const lifetime = Date.parse(upload.expiresAt) - before;
      expect(lifetime).toBeGreaterThan(15 * MINUTE - 5000);
      expect(lifetime).toBeLessThanOrEqual(15 * MINUTE + 5000);
    });

    it('still signs when the store is unreachable', async () => {
      const gone = new S3TestStore();
      await gone.start();
      const env = gone.env();
      await gone.stop();
      const moduleRef = await Test.createTestingModule({
        imports: [StorageModule.register(env)],
      }).compile();

      const upload = await moduleRef
        .get(StorageService)
        .createUpload('legal_document', 'acc_1', 'application/pdf', 100);

      expect(upload.key).toMatch(
        /^incoming\/legal_document\/acc_1\/[0-9a-f-]{36}$/,
      );
      expect(upload.url).toContain(env.STORAGE_ENDPOINT);
    });

    it('refuses a declared content type with a null byte as not allowed', async () => {
      const answer = await refusal(
        storage.createUpload('garage_photo', 'acc_1', 'image/jpeg\u0000', 10),
      );

      expect(answer.status).toBe(422);
    });
  });

  describe('downloads', () => {
    const key = `legal_document/acc_1/${ID}`;

    beforeEach(() => store.put(key, PDF, 'application/pdf'));

    it('does not let an unknown disposition inject a second parameter', async () => {
      const result = await storage
        .createDownloadUrl(
          key,
          'a.pdf',
          'inline; filename=evil.exe' as 'inline',
          5,
        )
        .then(
          (url) => fetch(url),
          () => undefined,
        );

      const header = result?.headers.get('content-disposition') ?? '';
      expect(header).not.toContain('evil');
    });

    it('accepts a fractional lifetime of half a minute and stops after it', async () => {
      const url = await storage.createDownloadUrl(
        key,
        undefined,
        'inline',
        0.5,
      );

      expect((await fetch(url)).status).toBe(200);
      store.now = () => Date.now() + MINUTE;
      expect((await fetch(url)).status).toBe(403);
    });

    it('refuses a lifetime given as a string', async () => {
      await expect(
        storage.createDownloadUrl(
          key,
          undefined,
          'inline',
          '5' as unknown as number,
        ),
      ).rejects.toThrow();
    });

    it('serves a file of tens of megabytes through an address', async () => {
      const bigKey = `repair_invoice/acc_1/${ID}`;
      store.put(
        bigKey,
        Buffer.concat([PDF, Buffer.alloc(30 * MB)]),
        'application/pdf',
      );

      const res = await fetch(
        await storage.createDownloadUrl(bigKey, 'big.pdf', 'attachment', 5),
      );

      expect((await res.arrayBuffer()).byteLength).toBe(PDF.length + 30 * MB);
    });

    it('gives two addresses for the same file that both work', async () => {
      const [a, b] = await Promise.all([
        storage.createDownloadUrl(key, 'a.pdf', 'inline', 5),
        storage.createDownloadUrl(key, 'a.pdf', 'inline', 5),
      ]);

      expect((await fetch(a)).status).toBe(200);
      expect((await fetch(b)).status).toBe(200);
    });
  });

  describe('server writes and deletes', () => {
    it('keeps the last write when two writes race to the same key', async () => {
      await Promise.all([
        storage.putObject('exports/race', 'one', 'text/plain'),
        storage.putObject('exports/race', 'two', 'text/plain'),
      ]);

      expect(['one', 'two']).toContain(
        store.objects.get('exports/race')?.body.toString(),
      );
    });

    it('fails a delete when the store is unreachable and succeeds when repeated against a live store', async () => {
      const gone = new S3TestStore();
      await gone.start();
      const env = gone.env();
      await gone.stop();
      const dead = (
        await Test.createTestingModule({
          imports: [StorageModule.register(env)],
        }).compile()
      ).get(StorageService);

      await expect(dead.deleteObject('a/b')).rejects.toThrow();
      await expect(
        dead.confirmUpload(
          `incoming/garage_photo/acc_1/${ID}`,
          'garage_photo',
          'acc_1',
        ),
      ).rejects.not.toBeInstanceOf(HttpException);
      await expect(storage.deleteObject('a/b')).resolves.toBeUndefined();
    });

    it('deletes an object that was just written in the same call sequence', async () => {
      await storage.putObject('exports/x', 'x', 'text/plain');
      await storage.deleteObject('exports/x');

      expect(store.objects.has('exports/x')).toBe(false);
    });
  });
});
