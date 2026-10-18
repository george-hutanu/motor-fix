// @traces 1191-FR-005
// @traces 1191-FR-006
import { crc32 } from 'node:zlib';

import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { S3TestStore } from './s3-test-store';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49]);
const TEN_MB = 10 * 1024 * 1024;
const ftyp = (brand: string, size = 24) =>
  Buffer.concat([
    Buffer.from([0, 0, 0, size]),
    Buffer.from(`ftyp${brand}`, 'latin1'),
    Buffer.alloc(8),
  ]);

const sumOf = (file: Buffer) => {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(crc32(file));
  return out.toString('base64');
};

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpException);
  const http = error as HttpException;
  return {
    code: (http.getResponse() as { code?: string }).code,
    status: http.getStatus(),
  };
}

describe('the HEIC signature at confirm and the upload address, hostile', () => {
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
  });

  async function uploaded(file: Buffer, declared: string) {
    const upload = await storage.createUpload(
      'garage_photo',
      'acc_1',
      declared,
      file.length,
      sumOf(file),
    );
    const put = await fetch(upload.url, {
      body: new Uint8Array(file),
      headers: upload.headers,
      method: 'PUT',
    });
    expect(put.status).toBe(200);
    return upload.key;
  }

  describe('the brand of an ISO media file', () => {
    it.each(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heif'])(
      'takes brand %s declared as image/heic and as image/heif',
      async (brand) => {
        for (const declared of ['image/heic', 'image/heif']) {
          const key = await uploaded(ftyp(brand), declared);

          const final = await storage.confirmUpload(
            key,
            'garage_photo',
            'acc_1',
          );

          expect(final).toMatch(/^garage_photo\/acc_1\/[0-9a-f-]{36}$/);
          expect(store.objects.has(key)).toBe(false);
        }
      },
    );

    it.each([
      ['an MP4', 'isom'],
      ['an MP4 v2', 'mp42'],
      ['an AVIF', 'avif'],
      ['a QuickTime movie', 'qt  '],
      ['an upper-case brand', 'HEIC'],
      ['a brand with a trailing space', 'hei '],
      ['an empty brand', '\0\0\0\0'],
    ])('refuses %s declared as HEIC and deletes it', async (_what, brand) => {
      const key = await uploaded(ftyp(brand), 'image/heic');

      expect(
        await refusal(storage.confirmUpload(key, 'garage_photo', 'acc_1')),
      ).toEqual({ code: 'file_type_mismatch', status: 422 });
      expect(store.objects.has(key)).toBe(false);
    });

    it('refuses a file whose ftyp box sits at the wrong offset', async () => {
      const shifted = Buffer.concat([Buffer.from([0]), ftyp('heic')]);
      const key = await uploaded(shifted, 'image/heic');

      expect(
        await refusal(storage.confirmUpload(key, 'garage_photo', 'acc_1')),
      ).toEqual({ code: 'file_type_mismatch', status: 422 });
    });

    it.each([1, 4, 8, 11])(
      'refuses a %i-byte file cut inside the ftyp box and deletes it',
      async (length) => {
        const key = await uploaded(
          ftyp('heic').subarray(0, length),
          'image/heic',
        );

        expect(
          await refusal(storage.confirmUpload(key, 'garage_photo', 'acc_1')),
        ).toEqual({ code: 'file_type_mismatch', status: 422 });
        expect(store.objects.has(key)).toBe(false);
      },
    );

    it('takes a file that is only the 12-byte ftyp head', async () => {
      const key = await uploaded(ftyp('heic').subarray(0, 12), 'image/heic');

      await expect(
        storage.confirmUpload(key, 'garage_photo', 'acc_1'),
      ).resolves.toMatch(/^garage_photo\/acc_1\//);
    });

    it('refuses real HEIC bytes declared as a JPEG', async () => {
      const key = await uploaded(ftyp('heic'), 'image/jpeg');

      expect(
        await refusal(storage.confirmUpload(key, 'garage_photo', 'acc_1')),
      ).toEqual({ code: 'file_type_mismatch', status: 422 });
      expect(store.objects.has(key)).toBe(false);
    });

    it('refuses JPEG bytes declared as HEIC and as HEIF', async () => {
      for (const declared of ['image/heic', 'image/heif']) {
        const key = await uploaded(JPEG, declared);

        expect(
          await refusal(storage.confirmUpload(key, 'garage_photo', 'acc_1')),
        ).toEqual({ code: 'file_type_mismatch', status: 422 });
      }
    });

    it('refuses an HEIC stored for a purpose that does not take it', async () => {
      const upload = await storage.createUpload(
        'garage_photo',
        'acc_1',
        'image/heic',
        ftyp('heic').length,
        sumOf(ftyp('heic')),
      );
      await fetch(upload.url, {
        body: new Uint8Array(ftyp('heic')),
        headers: upload.headers,
        method: 'PUT',
      });
      const wrong = upload.key.replace('garage_photo', 'mechanic_photo');
      store.objects.set(wrong, store.objects.get(upload.key)!);

      expect(
        await refusal(storage.confirmUpload(wrong, 'mechanic_photo', 'acc_1')),
      ).toEqual({ code: 'file_type_mismatch', status: 422 });
    });
  });

  describe('which purposes may ask for an HEIC address', () => {
    it.each([
      'message_photo',
      'mechanic_photo',
      'legal_document',
      'repair_invoice',
    ] as const)('refuses image/heic and image/heif for %s', async (purpose) => {
      for (const type of ['image/heic', 'image/heif']) {
        expect(
          await refusal(
            storage.createUpload(purpose, 'acc_1', type, 100, 'AAAAAA=='),
          ),
        ).toEqual({ code: 'file_type_not_allowed', status: 422 });
      }
    });

    it.each([
      'IMAGE/HEIC',
      'image/heic; charset=binary',
      ' image/heic',
      'image/heics',
      'image/heic-sequence',
    ])('refuses the near-miss type %j for a garage photo', async (type) => {
      expect(
        await refusal(
          storage.createUpload('garage_photo', 'acc_1', type, 100, 'AAAAAA=='),
        ),
      ).toEqual({ code: 'file_type_not_allowed', status: 422 });
    });
  });

  describe('the size the address is bound to', () => {
    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'refuses a size of %p with 400 validation_failed',
      async (size) => {
        expect(
          await refusal(
            storage.createUpload(
              'garage_photo',
              'acc_1',
              'image/jpeg',
              size,
              'AAAAAA==',
            ),
          ),
        ).toEqual({ code: 'validation_failed', status: 400 });
      },
    );

    it('takes exactly 10 MB and refuses one byte more', async () => {
      await expect(
        storage.createUpload(
          'garage_photo',
          'acc_1',
          'image/heic',
          TEN_MB,
          'AAAAAA==',
        ),
      ).resolves.toMatchObject({ key: expect.stringMatching(/^incoming\//) });
      expect(
        (
          await refusal(
            storage.createUpload(
              'garage_photo',
              'acc_1',
              'image/heic',
              TEN_MB + 1,
              'AAAAAA==',
            ),
          )
        ).status,
      ).toBe(422);
    });
  });

  describe('the store holding the browser to its declaration', () => {
    async function address(file: Buffer, declared = 'image/jpeg') {
      return storage.createUpload(
        'garage_photo',
        'acc_1',
        declared,
        file.length,
        sumOf(file),
      );
    }
    const put = (url: string, body: Buffer, headers: Record<string, string>) =>
      fetch(url, { body: new Uint8Array(body), headers, method: 'PUT' });

    it('refuses a body one byte longer than declared', async () => {
      const upload = await address(JPEG);

      const response = await put(
        upload.url,
        Buffer.concat([JPEG, Buffer.from([0])]),
        upload.headers,
      );

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(store.objects.has(upload.key)).toBe(false);
    });

    it('refuses a body one byte shorter than declared', async () => {
      const upload = await address(JPEG);

      const response = await put(
        upload.url,
        JPEG.subarray(0, JPEG.length - 1),
        upload.headers,
      );

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(store.objects.has(upload.key)).toBe(false);
    });

    it('refuses a body whose bytes differ at the same length', async () => {
      const upload = await address(JPEG);
      const flipped = Buffer.from(JPEG);
      flipped[flipped.length - 1] ^= 0xff;

      const response = await put(upload.url, flipped, upload.headers);

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(store.objects.has(upload.key)).toBe(false);
    });

    it('refuses a PUT that leaves out the checksum header', async () => {
      const upload = await address(JPEG);

      const response = await put(upload.url, JPEG, {
        'Content-Type': 'image/jpeg',
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(store.objects.has(upload.key)).toBe(false);
    });

    it('refuses a PUT that leaves out the content type', async () => {
      const upload = await address(JPEG);

      const response = await put(upload.url, JPEG, {
        'x-amz-checksum-crc32': upload.headers['x-amz-checksum-crc32']!,
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(store.objects.has(upload.key)).toBe(false);
    });

    it('refuses a PUT a second after the 15 minutes', async () => {
      const upload = await address(JPEG);
      store.now = () => Date.now() + 15 * 60_000 + 1000;

      const response = await put(upload.url, JPEG, upload.headers);

      expect(response.status).toBe(403);
    });

    it('refuses a PUT of the empty body for the checksum of nothing when a file was declared', async () => {
      const upload = await address(JPEG);

      const response = await put(upload.url, Buffer.alloc(0), {
        ...upload.headers,
        'x-amz-checksum-crc32': 'AAAAAA==',
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('keys the browser invents at confirm', () => {
    it.each([
      'incoming/garage_photo/acc_1/../acc_2/00000000-0000-4000-8000-000000000000',
      'incoming/garage_photo/acc_1/00000000-0000-4000-8000-000000000000/../x',
      'incoming/garage_photo/acc_1/',
      'incoming/garage_photo/acc_1/00000000-0000-4000-8000-00000000000G',
      'incoming/garage_photo/acc_2/00000000-0000-4000-8000-000000000000',
      'garage_photo/acc_1/00000000-0000-4000-8000-000000000000',
      '',
    ])('answers file_missing for the key %j', async (key) => {
      expect(
        await refusal(storage.confirmUpload(key, 'garage_photo', 'acc_1')),
      ).toEqual({ code: 'file_missing', status: 409 });
    });

    it('answers file_missing the second time the same incoming key is confirmed at storage level', async () => {
      const key = await uploaded(ftyp('heic'), 'image/heic');
      await storage.confirmUpload(key, 'garage_photo', 'acc_1');

      expect(
        await refusal(storage.confirmUpload(key, 'garage_photo', 'acc_1')),
      ).toEqual({ code: 'file_missing', status: 409 });
    });
  });
});
