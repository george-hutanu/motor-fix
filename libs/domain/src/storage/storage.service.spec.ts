import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { S3TestStore } from './s3-test-store';
import { StorageModule } from './storage.module';
import { type SignedUpload, StorageService } from './storage.service';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
]);
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n');
const EXE = Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00');
const TEN_MB = 10 * 1024 * 1024;
const MINUTE = 60_000;
const INCOMING_KEY = /^incoming\/garage_photo\/acc_1\/[0-9a-f-]{36}$/;

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

function send(upload: SignedUpload, file: Buffer, fields = upload.fields) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  form.append('file', new Blob([new Uint8Array(file)]));
  return fetch(upload.url, { body: form, method: 'POST' });
}

describe('StorageService', () => {
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
    store.beforeDelete = undefined;
  });

  async function uploaded(
    file: Buffer,
    contentType = 'image/jpeg',
    purpose: Parameters<StorageService['createUpload']>[0] = 'garage_photo',
  ) {
    const upload = await storage.createUpload(
      purpose,
      'acc_1',
      contentType,
      file.length,
    );
    expect((await send(upload, file)).status).toBe(204);
    return upload.key;
  }

  describe('asking for an upload', () => {
    it('signs a form for one incoming key, the declared type, valid 15 minutes', async () => {
      const upload = await storage.createUpload(
        'garage_photo',
        'acc_1',
        'image/jpeg',
        3 * 1024 * 1024,
      );

      expect(upload.key).toMatch(INCOMING_KEY);
      expect(upload.url).toBe(`${store.env().STORAGE_ENDPOINT}/motorfix`);
      expect(upload.fields).toMatchObject({
        'Content-Type': 'image/jpeg',
        key: upload.key,
      });
      const lifetime = Date.parse(upload.expiresAt) - Date.now();
      expect(lifetime).toBeGreaterThan(14 * MINUTE);
      expect(lifetime).toBeLessThanOrEqual(15 * MINUTE);
    });

    it('gives every upload its own key', async () => {
      const [a, b] = await Promise.all([
        storage.createUpload('garage_photo', 'acc_1', 'image/jpeg', 10),
        storage.createUpload('garage_photo', 'acc_1', 'image/jpeg', 10),
      ]);

      expect(a.key).not.toBe(b.key);
    });

    it('refuses a type the purpose does not allow', async () => {
      expect(
        await refusal(
          storage.createUpload('garage_photo', 'acc_1', 'application/zip', 10),
        ),
      ).toEqual({ code: 'file_type_not_allowed', status: 422 });
    });

    it('refuses a PDF as a garage photo but takes it as a legal document', async () => {
      expect(
        await refusal(
          storage.createUpload('garage_photo', 'acc_1', 'application/pdf', 10),
        ),
      ).toEqual({ code: 'file_type_not_allowed', status: 422 });
      await expect(
        storage.createUpload('legal_document', 'acc_1', 'application/pdf', 10),
      ).resolves.toMatchObject({
        fields: { 'Content-Type': 'application/pdf' },
      });
    });

    it('refuses a size above the purpose limit and takes the limit itself', async () => {
      expect(
        await refusal(
          storage.createUpload(
            'garage_photo',
            'acc_1',
            'image/jpeg',
            12 * 1024 * 1024,
          ),
        ),
      ).toEqual({ code: 'file_too_large', status: 422 });
      await expect(
        storage.createUpload('garage_photo', 'acc_1', 'image/jpeg', TEN_MB),
      ).resolves.toBeDefined();
      expect(
        await refusal(
          storage.createUpload(
            'garage_photo',
            'acc_1',
            'image/jpeg',
            TEN_MB + 1,
          ),
        ),
      ).toEqual({ code: 'file_too_large', status: 422 });
    });

    it.each([
      ['a zero size', 'garage_photo', 'acc_1', 0],
      ['a negative size', 'garage_photo', 'acc_1', -1],
      ['a fractional size', 'garage_photo', 'acc_1', 1.5],
      ['a size that is not a number', 'garage_photo', 'acc_1', Number.NaN],
      ['an unknown purpose', 'avatar', 'acc_1', 10],
      ['an owner id with a slash', 'garage_photo', '../acc_2', 10],
      ['an owner id with a space', 'garage_photo', 'acc 1', 10],
      ['an empty owner id', 'garage_photo', '', 10],
      ['an owner id over 64 characters', 'garage_photo', 'a'.repeat(65), 10],
    ])('refuses %s as a bad request', async (_, purpose, owner, size) => {
      const answer = await refusal(
        storage.createUpload(
          purpose as 'garage_photo',
          owner,
          'image/jpeg',
          size,
        ),
      );

      expect(answer.status).toBe(400);
    });
  });

  describe('the signed upload form', () => {
    it('lets the browser store the declared file under its key', async () => {
      const key = await uploaded(JPEG);

      expect(store.objects.get(key)).toMatchObject({
        body: JPEG,
        contentType: 'image/jpeg',
      });
    });

    it('is refused by the store for a file larger than declared', async () => {
      const upload = await storage.createUpload(
        'garage_photo',
        'acc_1',
        'image/jpeg',
        JPEG.length - 1,
      );

      const res = await send(upload, JPEG);

      expect(res.status).toBe(400);
      expect(await res.text()).toContain('EntityTooLarge');
      expect(store.objects.size).toBe(0);
    });

    it('is refused by the store for another content type', async () => {
      const upload = await storage.createUpload(
        'garage_photo',
        'acc_1',
        'image/jpeg',
        JPEG.length,
      );

      const res = await send(upload, JPEG, {
        ...upload.fields,
        'Content-Type': 'text/html',
      });

      expect(res.status).toBe(403);
      expect(store.objects.size).toBe(0);
    });

    it('is refused by the store for another key', async () => {
      const upload = await storage.createUpload(
        'garage_photo',
        'acc_1',
        'image/jpeg',
        JPEG.length,
      );

      const res = await send(upload, JPEG, {
        ...upload.fields,
        key: 'garage_photo/acc_2/taken',
      });

      expect(res.status).toBe(403);
      expect(store.objects.size).toBe(0);
    });

    it('is refused by the store after 15 minutes', async () => {
      const upload = await storage.createUpload(
        'garage_photo',
        'acc_1',
        'image/jpeg',
        JPEG.length,
      );
      store.now = () => Date.now() + 16 * MINUTE;

      expect((await send(upload, JPEG)).status).toBe(403);
    });
  });

  describe('confirming an upload', () => {
    it('moves the checked file to its final key and returns that key', async () => {
      const key = await uploaded(JPEG);

      const final = await storage.confirmUpload(key, 'garage_photo', 'acc_1');

      expect(final).toBe(key.replace(/^incoming\//, ''));
      expect(final).toMatch(/^garage_photo\/acc_1\/[0-9a-f-]{36}$/);
      expect(store.objects.get(final)).toMatchObject({
        body: JPEG,
        contentType: 'image/jpeg',
      });
      expect(store.objects.has(key)).toBe(false);
    });

    it.each([
      ['a PNG', PNG, 'image/png', 'garage_photo'],
      ['a WebP', WEBP, 'image/webp', 'message_photo'],
      ['a PDF', PDF, 'application/pdf', 'legal_document'],
      ['a JPEG invoice', JPEG, 'image/jpeg', 'repair_invoice'],
    ] as const)(
      'accepts %s whose first bytes match its type',
      async (_, file, type, purpose) => {
        const upload = await storage.createUpload(
          purpose,
          'acc_1',
          type,
          file.length,
        );
        await send(upload, file);

        await expect(
          storage.confirmUpload(upload.key, purpose, 'acc_1'),
        ).resolves.toBe(upload.key.replace(/^incoming\//, ''));
      },
    );

    it('deletes a file whose first bytes do not match its type', async () => {
      const key = await uploaded(EXE);

      expect(
        await refusal(storage.confirmUpload(key, 'garage_photo', 'acc_1')),
      ).toEqual({ code: 'file_type_mismatch', status: 422 });
      expect(store.objects.size).toBe(0);
    });

    it('deletes a PNG sent as a JPEG', async () => {
      const key = await uploaded(PNG, 'image/jpeg');

      expect(
        await refusal(storage.confirmUpload(key, 'garage_photo', 'acc_1')),
      ).toEqual({ code: 'file_type_mismatch', status: 422 });
      expect(store.objects.size).toBe(0);
    });

    it('deletes a file shorter than any signature', async () => {
      const key = await uploaded(Buffer.from([0xff, 0xd8]));

      expect(
        await refusal(storage.confirmUpload(key, 'garage_photo', 'acc_1')),
      ).toEqual({ code: 'file_type_mismatch', status: 422 });
      expect(store.objects.size).toBe(0);
    });

    it('deletes a stored object over the purpose limit', async () => {
      const key =
        'incoming/garage_photo/acc_1/00000000-0000-4000-8000-000000000000';
      store.put(key, Buffer.concat([JPEG, Buffer.alloc(TEN_MB)]), 'image/jpeg');

      expect(
        await refusal(storage.confirmUpload(key, 'garage_photo', 'acc_1')),
      ).toEqual({ code: 'file_too_large', status: 422 });
      expect(store.objects.size).toBe(0);
    });

    it('answers file_missing for a key that holds no object', async () => {
      const upload = await storage.createUpload(
        'garage_photo',
        'acc_1',
        'image/jpeg',
        10,
      );

      expect(
        await refusal(
          storage.confirmUpload(upload.key, 'garage_photo', 'acc_1'),
        ),
      ).toEqual({ code: 'file_missing', status: 409 });
    });

    it.each([
      ['another owner', 'garage_photo', 'acc_2'],
      ['another purpose', 'message_photo', 'acc_1'],
    ] as const)(
      'answers file_missing for a key of %s and touches nothing',
      async (_, purpose, owner) => {
        const key = await uploaded(JPEG);

        expect(
          await refusal(storage.confirmUpload(key, purpose, owner)),
        ).toEqual({
          code: 'file_missing',
          status: 409,
        });
        expect([...store.objects.keys()]).toEqual([key]);
      },
    );

    it('answers file_missing for a key outside incoming/ and touches nothing', async () => {
      const key = 'garage_photo/acc_1/00000000-0000-4000-8000-000000000000';
      store.put(key, JPEG, 'image/jpeg');

      expect(
        await refusal(storage.confirmUpload(key, 'garage_photo', 'acc_1')),
      ).toEqual({ code: 'file_missing', status: 409 });
      expect([...store.objects.keys()]).toEqual([key]);
    });

    it('does not move a file replaced while it was being checked', async () => {
      const key = await uploaded(JPEG);
      store.beforeCopy = () => store.put(key, EXE, 'image/jpeg');

      expect(
        await refusal(storage.confirmUpload(key, 'garage_photo', 'acc_1')),
      ).toEqual({ code: 'file_missing', status: 409 });
      expect(store.objects.has(key.replace(/^incoming\//, ''))).toBe(false);
    });

    it('returns the final key when removing the incoming object fails', async () => {
      const key = await uploaded(JPEG);
      store.beforeDelete = () => {
        throw new Error('store busy');
      };

      const final = await storage.confirmUpload(key, 'garage_photo', 'acc_1');

      expect(final).toBe(key.replace(/^incoming\//, ''));
      expect(store.objects.get(final)?.body).toEqual(JPEG);
    });

    it('still refuses a mismatched file when deleting it fails', async () => {
      const key = await uploaded(EXE);
      store.beforeDelete = () => {
        throw new Error('store busy');
      };

      expect(
        await refusal(storage.confirmUpload(key, 'garage_photo', 'acc_1')),
      ).toEqual({ code: 'file_type_mismatch', status: 422 });
      expect(store.objects.has(key.replace(/^incoming\//, ''))).toBe(false);
    });
  });

  describe('download addresses', () => {
    const key = 'legal_document/acc_1/00000000-0000-4000-8000-000000000000';

    beforeEach(() => store.put(key, PDF, 'application/pdf'));

    it('serves the one file as an attachment with a safe name', async () => {
      const url = await storage.createDownloadUrl(
        key,
        'Factură "Șerban"/\\\u0007x.pdf',
        'attachment',
        5,
      );

      const res = await fetch(url);

      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer())).toEqual(PDF);
      expect(res.headers.get('content-disposition')).toBe(
        `attachment; filename="Factur_ _erbanx.pdf"; filename*=UTF-8''Factur%C4%83%20%C8%98erbanx.pdf`,
      );
    });

    it('serves a file inline without a name', async () => {
      const res = await fetch(
        await storage.createDownloadUrl(key, undefined, 'inline', 5),
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('content-disposition')).toBe('inline');
    });

    it("points at the store's own address", async () => {
      const url = await storage.createDownloadUrl(key, 'a.pdf', 'inline', 5);

      expect(url.startsWith(`${store.env().STORAGE_ENDPOINT}/motorfix/`)).toBe(
        true,
      );
    });

    it('stops working after its lifetime', async () => {
      const url = await storage.createDownloadUrl(key, 'a.pdf', 'inline', 5);
      store.now = () => Date.now() + 4 * MINUTE;
      expect((await fetch(url)).status).toBe(200);

      store.now = () => Date.now() + 6 * MINUTE;
      expect((await fetch(url)).status).toBe(403);
    });

    it('keeps a public image address working for 60 minutes', async () => {
      const url = await storage.createDownloadUrl(key, undefined, 'inline', 60);
      store.now = () => Date.now() + 59 * MINUTE;
      expect((await fetch(url)).status).toBe(200);

      store.now = () => Date.now() + 61 * MINUTE;
      expect((await fetch(url)).status).toBe(403);
    });

    it('refuses a disposition other than inline or attachment', async () => {
      await expect(
        storage.createDownloadUrl(
          key,
          'a.pdf',
          'inline; filename=x.exe' as 'inline',
          5,
        ),
      ).rejects.toThrow(RangeError);
    });

    it('does not open another file', async () => {
      const other = 'legal_document/acc_2/00000000-0000-4000-8000-000000000001';
      store.put(other, PDF, 'application/pdf');
      const url = await storage.createDownloadUrl(key, 'a.pdf', 'inline', 5);

      const res = await fetch(url.replace(key, other));

      expect(res.status).toBe(403);
    });
  });

  describe('server writes and deletes', () => {
    it('writes a file the server made straight to its key', async () => {
      await storage.putObject(
        'day_sheet/gar_1/2026-10-04',
        PDF,
        'application/pdf',
      );

      expect(store.objects.get('day_sheet/gar_1/2026-10-04')).toMatchObject({
        body: PDF,
        contentType: 'application/pdf',
      });
      expect(store.objects.size).toBe(1);
    });

    it('deletes an object, and deleting it again succeeds', async () => {
      store.put('garage_photo/acc_1/x', JPEG, 'image/jpeg');

      await storage.deleteObject('garage_photo/acc_1/x');
      await expect(storage.deleteObject('garage_photo/acc_1/x')).resolves.toBe(
        undefined,
      );
      expect(store.objects.size).toBe(0);
    });
  });

  describe('ready check', () => {
    it('resolves when the bucket answers', async () => {
      await expect(storage.ready()).resolves.toBe(undefined);
    });

    it('rejects when the store is unreachable', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          StorageModule.register({
            ...store.env(),
            STORAGE_ENDPOINT: 'http://127.0.0.1:1',
          }),
        ],
      }).compile();

      await expect(moduleRef.get(StorageService).ready()).rejects.toThrow();
    });
  });
});
