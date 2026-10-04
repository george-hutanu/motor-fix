import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

import { FILE_RULES } from '@motor-fix/contracts';
import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { S3TestStore } from './s3-test-store';
import { StorageModule } from './storage.module';
import { type SignedUpload, StorageService } from './storage.service';

type Purpose = Parameters<StorageService['createUpload']>[0];

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const PDF = Buffer.from('%PDF-1.7\n');
const WAVE = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from('WAVEfmt '),
]);
const TEN_MB = 10 * 1024 * 1024;
const MINUTE = 60_000;
const FINAL_ID = '00000000-0000-4000-8000-000000000000';

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

describe('StorageService under hostile input', () => {
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

  async function uploaded(
    file: Buffer,
    contentType = 'image/jpeg',
    purpose: Purpose = 'garage_photo',
    owner = 'acc_1',
  ) {
    const upload = await storage.createUpload(
      purpose,
      owner,
      contentType,
      Math.max(file.length, 1),
    );
    expect((await send(upload, file)).status).toBe(204);
    return upload.key;
  }

  describe('the rules table', () => {
    it('names exactly the five purposes with a 10 MB limit each', () => {
      expect(Object.keys(FILE_RULES).sort()).toEqual([
        'garage_photo',
        'legal_document',
        'mechanic_photo',
        'message_photo',
        'repair_invoice',
      ]);
      for (const rule of Object.values(FILE_RULES)) {
        expect(rule.maxBytes).toBe(TEN_MB);
      }
    });

    it('keeps PDF out of the photo purposes and in the document purposes', () => {
      for (const purpose of [
        'garage_photo',
        'message_photo',
        'mechanic_photo',
      ] as const) {
        expect([...FILE_RULES[purpose].types].sort()).toEqual([
          'image/jpeg',
          'image/png',
          'image/webp',
        ]);
      }
      for (const purpose of ['legal_document', 'repair_invoice'] as const) {
        expect([...FILE_RULES[purpose].types].sort()).toEqual([
          'application/pdf',
          'image/jpeg',
          'image/png',
        ]);
      }
    });
  });

  describe('asking for an upload', () => {
    it.each([
      ['an inherited property name', 'constructor'],
      ['a prototype key', '__proto__'],
      ['a method name', 'toString'],
      ['an empty purpose', ''],
      ['a purpose in capitals', 'GARAGE_PHOTO'],
      ['a purpose with a trailing space', 'garage_photo '],
    ])('refuses %s as a purpose with 400', async (_, purpose) => {
      const answer = await refusal(
        storage.createUpload(purpose as Purpose, 'acc_1', 'image/jpeg', 10),
      );

      expect(answer.status).toBe(400);
    });

    it.each([
      ['a newline at the end', 'acc_1\n'],
      ['a leading newline', '\nacc_1'],
      ['a null byte', 'acc\u0000_1'],
      ['an accented letter', 'accé'],
      ['a fullwidth digit', 'acc_１'],
      ['an arabic-indic digit', 'acc_١'],
      ['a right-to-left override', 'acc‮1'],
      ['an emoji', 'acc_\u{1f697}'],
      ['a dot', '.'],
      ['two dots', '..'],
      ['a percent escape', '%2e%2e'],
      ['a backslash', 'acc\\1'],
      ['a colon', 'acc:1'],
      ['a plus sign', 'acc+1'],
      ['a tab', 'acc\t1'],
    ])('refuses an owner id with %s', async (_, owner) => {
      const answer = await refusal(
        storage.createUpload('garage_photo', owner, 'image/jpeg', 10),
      );

      expect(answer.status).toBe(400);
    });

    it.each([
      ['a single character', 'a'],
      ['a hyphen and an underscore', 'a-b_c'],
      ['capitals and digits', 'ABC123'],
      ['exactly 64 characters', 'a'.repeat(64)],
    ])('takes an owner id of %s', async (_, owner) => {
      const upload = await storage.createUpload(
        'garage_photo',
        owner,
        'image/jpeg',
        10,
      );

      expect(upload.key).toMatch(
        new RegExp(`^incoming/garage_photo/${owner}/[0-9a-f-]{36}$`),
      );
    });

    it.each([
      ['Infinity', Number.POSITIVE_INFINITY],
      ['negative infinity', Number.NEGATIVE_INFINITY],
      ['negative zero', -0],
      ['a tiny fraction', 0.1],
      ['a numeric string', '10'],
      ['null', null],
      ['undefined', undefined],
      ['a bigint', 10n],
      ['a boxed number', Object('10')],
    ])('refuses %s as a size with 400', async (_, size) => {
      const answer = await refusal(
        storage.createUpload(
          'garage_photo',
          'acc_1',
          'image/jpeg',
          size as number,
        ),
      );

      expect(answer.status).toBe(400);
    });

    it('takes a size of one byte', async () => {
      await expect(
        storage.createUpload('garage_photo', 'acc_1', 'image/jpeg', 1),
      ).resolves.toMatchObject({ fields: { 'Content-Type': 'image/jpeg' } });
    });

    it('refuses the largest safe integer as too large, not as a bad request', async () => {
      expect(
        await refusal(
          storage.createUpload(
            'garage_photo',
            'acc_1',
            'image/jpeg',
            Number.MAX_SAFE_INTEGER,
          ),
        ),
      ).toEqual({ code: 'file_too_large', status: 422 });
    });

    it.each([
      ['capitals', 'IMAGE/JPEG'],
      ['a charset parameter', 'image/jpeg; charset=utf-8'],
      ['a trailing semicolon', 'image/jpeg;'],
      ['a leading space', ' image/jpeg'],
      ['a trailing space', 'image/jpeg '],
      ['a trailing newline', 'image/jpeg\n'],
      ['an injected header', 'image/jpeg\r\nX-Evil: 1'],
      ['a wildcard', 'image/*'],
      ['a bare wildcard', '*/*'],
      ['an empty string', ''],
      ['a subtype suffix', 'image/jpeg+xml'],
      ['a similar type', 'image/jpg'],
    ])('never signs a form for a type with %s unless the form pins the exact allowed type', async (_, type) => {
      const outcome = await storage
        .createUpload('garage_photo', 'acc_1', type, 10)
        .then(
          (upload) => ({ upload }),
          (error: unknown) => ({ error }),
        );

      if ('error' in outcome) {
        expect(outcome.error).toBeInstanceOf(HttpException);
        expect((outcome.error as HttpException).getStatus()).toBe(422);
      } else {
        expect(FILE_RULES.garage_photo.types).toContain(
          outcome.upload.fields['Content-Type'],
        );
      }
    });

    it.each([
      ['capitals', 'IMAGE/JPEG'],
      ['a charset parameter', 'image/jpeg; charset=x'],
      ['an injected header', 'image/jpeg\r\nX-Evil: 1'],
      ['a wildcard', 'image/*'],
    ])('refuses a type with %s with file_type_not_allowed', async (_, type) => {
      expect(
        await refusal(storage.createUpload('garage_photo', 'acc_1', type, 10)),
      ).toEqual({ code: 'file_type_not_allowed', status: 422 });
    });

    it('checks the type before the size', async () => {
      expect(
        await refusal(
          storage.createUpload(
            'garage_photo',
            'acc_1',
            'application/zip',
            TEN_MB + 1,
          ),
        ),
      ).toEqual({ code: 'file_type_not_allowed', status: 422 });
    });

    it('issues no key and no form fields that carry the secret or a file name', async () => {
      const upload = await storage.createUpload(
        'garage_photo',
        'acc_1',
        'image/jpeg',
        10,
      );

      const text = JSON.stringify(upload);

      expect(text).not.toContain(store.env().STORAGE_SECRET_ACCESS_KEY);
      expect(upload.key.split('/')).toHaveLength(4);
      expect(Date.parse(upload.expiresAt)).not.toBeNaN();
      expect(new Date(upload.expiresAt).toISOString()).toBe(upload.expiresAt);
    });

    it('issues unique keys across a thousand calls', async () => {
      const uploads = await Promise.all(
        Array.from({ length: 1000 }, () =>
          storage.createUpload('garage_photo', 'acc_1', 'image/jpeg', 10),
        ),
      );

      expect(new Set(uploads.map((u) => u.key)).size).toBe(1000);
    });
  });

  describe('the signed upload form', () => {
    it('is refused by the store with an extra metadata field', async () => {
      const upload = await storage.createUpload(
        'garage_photo',
        'acc_1',
        'image/jpeg',
        JPEG.length,
      );

      const res = await send(upload, JPEG, {
        ...upload.fields,
        'x-amz-meta-owner': 'acc_2',
      });

      expect(res.status).toBe(403);
      expect(store.objects.size).toBe(0);
    });

    it.each([
      ['a longer key', (key: string) => `${key}x`],
      [
        'a traversal out of the prefix',
        (key: string) => `${key}/../../acc_2/x`,
      ],
      ['the final key', (key: string) => key.replace(/^incoming\//, '')],
      ['an empty key', () => ''],
    ])('is refused by the store for %s', async (_, change) => {
      const upload = await storage.createUpload(
        'garage_photo',
        'acc_1',
        'image/jpeg',
        JPEG.length,
      );

      const res = await send(upload, JPEG, {
        ...upload.fields,
        key: change(upload.key),
      });

      expect(res.status).toBe(403);
      expect(store.objects.size).toBe(0);
    });

    it.each([
      ['capitals', 'IMAGE/JPEG'],
      ['a parameter', 'image/jpeg; charset=x'],
    ])('is refused by the store for a content type with %s', async (_, type) => {
      const upload = await storage.createUpload(
        'garage_photo',
        'acc_1',
        'image/jpeg',
        JPEG.length,
      );

      const res = await send(upload, JPEG, {
        ...upload.fields,
        'Content-Type': type,
      });

      expect(res.status).toBe(403);
      expect(store.objects.size).toBe(0);
    });

    it('takes a file of exactly the declared size and refuses one byte more', async () => {
      const upload = await storage.createUpload(
        'garage_photo',
        'acc_1',
        'image/jpeg',
        JPEG.length,
      );

      const over = await send(upload, Buffer.concat([JPEG, Buffer.from([0])]));
      expect(over.status).toBe(400);
      expect(store.objects.size).toBe(0);

      expect((await send(upload, JPEG)).status).toBe(204);
      expect(store.objects.size).toBe(1);
    });

    it('is refused by the store with the signature removed', async () => {
      const upload = await storage.createUpload(
        'garage_photo',
        'acc_1',
        'image/jpeg',
        JPEG.length,
      );
      const { 'X-Amz-Signature': _signature, ...rest } = upload.fields;

      const res = await send(upload, JPEG, rest);

      expect(res.status).toBe(403);
      expect(store.objects.size).toBe(0);
    });

    it('is refused by the store one minute past its lifetime and works one minute before', async () => {
      const upload = await storage.createUpload(
        'garage_photo',
        'acc_1',
        'image/jpeg',
        JPEG.length,
      );
      const issued = Date.now();

      store.now = () => issued + 14 * MINUTE;
      expect((await send(upload, JPEG)).status).toBe(204);

      store.now = () => issued + 16 * MINUTE;
      expect((await send(upload, JPEG)).status).toBe(403);
    });
  });

  describe('confirming an upload', () => {
    it('answers file_missing the second time and leaves the final file in place', async () => {
      const key = await uploaded(JPEG);
      const final = await storage.confirmUpload(key, 'garage_photo', 'acc_1');

      expect(
        await refusal(storage.confirmUpload(key, 'garage_photo', 'acc_1')),
      ).toEqual({ code: 'file_missing', status: 409 });
      expect(store.objects.get(final)?.body).toEqual(JPEG);
      expect(store.objects.size).toBe(1);
    });

    it('answers file_missing for a key whose object was deleted', async () => {
      const key = await uploaded(JPEG);
      await storage.deleteObject(key);

      expect(
        await refusal(storage.confirmUpload(key, 'garage_photo', 'acc_1')),
      ).toEqual({ code: 'file_missing', status: 409 });
      expect(store.objects.size).toBe(0);
    });

    it('leaves a single final file when two confirms race', async () => {
      const key = await uploaded(JPEG);

      const results = await Promise.allSettled([
        storage.confirmUpload(key, 'garage_photo', 'acc_1'),
        storage.confirmUpload(key, 'garage_photo', 'acc_1'),
      ]);

      const final = key.replace(/^incoming\//, '');
      expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
      for (const r of results) {
        if (r.status === 'rejected') {
          expect(r.reason).toBeInstanceOf(HttpException);
          expect((r.reason as HttpException).getResponse()).toMatchObject({
            code: 'file_missing',
          });
        } else {
          expect(r.value).toBe(final);
        }
      }
      expect([...store.objects.keys()]).toEqual([final]);
    });

    it('does not let a replayed upload form overwrite an already confirmed file', async () => {
      const upload = await storage.createUpload(
        'garage_photo',
        'acc_1',
        'image/jpeg',
        JPEG.length,
      );
      expect((await send(upload, JPEG)).status).toBe(204);
      const final = await storage.confirmUpload(
        upload.key,
        'garage_photo',
        'acc_1',
      );
      const replacement = Buffer.concat([
        JPEG.subarray(0, 4),
        Buffer.from('XXXXX'),
      ]);

      await send(upload, replacement);
      await storage
        .confirmUpload(upload.key, 'garage_photo', 'acc_1')
        .catch(() => undefined);

      expect(store.objects.get(final)?.body).toEqual(JPEG);
    });

    it.each([
      ['an empty key', ''],
      ['the bare prefix', 'incoming/'],
      ['a prefix without a random id', 'incoming/garage_photo/acc_1/'],
      ['a key with a leading slash', '/incoming/garage_photo/acc_1/x'],
      ['a key in capitals', 'INCOMING/garage_photo/acc_1/x'],
      ['a sibling owner sharing the prefix', 'incoming/garage_photo/acc_10/x'],
      [
        'a traversal into another owner',
        `incoming/garage_photo/acc_1/../../../garage_photo/acc_2/${FINAL_ID}`,
      ],
      ['an encoded traversal', 'incoming/garage_photo/acc_1/%2e%2e/acc_2/x'],
      ['a key with a newline', 'incoming/garage_photo/acc_1/x\n'],
    ])('answers file_missing for %s and touches nothing', async (_, key) => {
      const victim = `garage_photo/acc_2/${FINAL_ID}`;
      store.put(victim, JPEG, 'image/jpeg');
      store.put('incoming/garage_photo/acc_10/x', JPEG, 'image/jpeg');
      const before = [...store.objects.keys()].sort();

      expect(
        await refusal(storage.confirmUpload(key, 'garage_photo', 'acc_1')),
      ).toEqual({ code: 'file_missing', status: 409 });
      expect([...store.objects.keys()].sort()).toEqual(before);
    });

    it('does not move an object whose key is an issued key of another owner with a unicode lookalike id', async () => {
      const key = await uploaded(JPEG);

      const answer = await refusal(
        storage.confirmUpload(key, 'garage_photo', 'acc_１'),
      );

      expect([400, 409]).toContain(answer.status);
      expect([...store.objects.keys()]).toEqual([key]);
    });

    it('rejects an unknown purpose or owner without touching the object', async () => {
      const key = await uploaded(JPEG);

      const answer = await refusal(
        storage.confirmUpload(key, 'constructor' as Purpose, 'acc_1'),
      );

      expect([400, 409]).toContain(answer.status);
      expect([...store.objects.keys()]).toEqual([key]);
    });

    it('accepts an object of exactly the purpose limit and deletes one byte more', async () => {
      const exact = `incoming/garage_photo/acc_1/${FINAL_ID}`;
      store.put(
        exact,
        Buffer.concat([JPEG, Buffer.alloc(TEN_MB - JPEG.length)]),
        'image/jpeg',
      );
      await expect(
        storage.confirmUpload(exact, 'garage_photo', 'acc_1'),
      ).resolves.toBe(`garage_photo/acc_1/${FINAL_ID}`);

      const over =
        'incoming/garage_photo/acc_1/11111111-1111-4111-8111-111111111111';
      store.put(
        over,
        Buffer.concat([JPEG, Buffer.alloc(TEN_MB - JPEG.length + 1)]),
        'image/jpeg',
      );
      expect(
        await refusal(storage.confirmUpload(over, 'garage_photo', 'acc_1')),
      ).toEqual({ code: 'file_too_large', status: 422 });
      expect(store.objects.has(over)).toBe(false);
    });

    it('deletes an empty object as a type mismatch', async () => {
      const key = `incoming/garage_photo/acc_1/${FINAL_ID}`;
      store.put(key, Buffer.alloc(0), 'image/jpeg');

      expect(
        await refusal(storage.confirmUpload(key, 'garage_photo', 'acc_1')),
      ).toEqual({ code: 'file_type_mismatch', status: 422 });
      expect(store.objects.size).toBe(0);
    });

    it.each([
      ['a PDF declared as PNG', PDF, 'image/png'],
      ['a JPEG declared as PDF', JPEG, 'application/pdf'],
      ['a RIFF wave declared as WebP', WAVE, 'image/webp'],
      [
        'a RIFF header with no form type declared as WebP',
        Buffer.from('RIFF\u0000\u0000\u0000\u0000'),
        'image/webp',
      ],
      ['a PNG signature cut one byte short', PNG.subarray(0, 7), 'image/png'],
      ['a lone PDF percent sign', Buffer.from('%'), 'application/pdf'],
      [
        'a PDF with leading whitespace',
        Buffer.from(' %PDF-1.7'),
        'application/pdf',
      ],
      [
        'text that begins like HTML',
        Buffer.from('<html><script>'),
        'image/png',
      ],
    ])('deletes %s', async (_, body, type) => {
      const key = `incoming/legal_document/acc_1/${FINAL_ID}`;
      store.put(key, body, type);

      expect(
        await refusal(storage.confirmUpload(key, 'legal_document', 'acc_1')),
      ).toEqual({ code: 'file_type_mismatch', status: 422 });
      expect(store.objects.size).toBe(0);
    });

    it('never moves an object whose stored type the purpose does not allow, even with matching bytes', async () => {
      const key = `incoming/garage_photo/acc_1/${FINAL_ID}`;
      store.put(key, PDF, 'application/pdf');

      const answer = await refusal(
        storage.confirmUpload(key, 'garage_photo', 'acc_1'),
      );

      expect(answer.status).toBe(422);
      expect(store.objects.has(`garage_photo/acc_1/${FINAL_ID}`)).toBe(false);
    });

    it('never moves an object stored with a scripting type', async () => {
      const key = `incoming/garage_photo/acc_1/${FINAL_ID}`;
      store.put(key, JPEG, 'text/html');

      const answer = await refusal(
        storage.confirmUpload(key, 'garage_photo', 'acc_1'),
      );

      expect(answer.status).toBe(422);
      expect(store.objects.has(`garage_photo/acc_1/${FINAL_ID}`)).toBe(false);
    });

    it('keeps the stored content type on the final object', async () => {
      const key = await uploaded(PNG, 'image/png');

      const final = await storage.confirmUpload(key, 'garage_photo', 'acc_1');

      expect(store.objects.get(final)?.contentType).toBe('image/png');
    });

    it('leaves the incoming object when the store fails during the move', async () => {
      const key = await uploaded(JPEG);
      const offline = new S3TestStore();
      await offline.start();
      const env = {
        ...store.env(),
        STORAGE_ENDPOINT: offline.env().STORAGE_ENDPOINT,
      };
      await offline.stop();
      const moduleRef = await Test.createTestingModule({
        imports: [StorageModule.register(env)],
      }).compile();

      await expect(
        moduleRef
          .get(StorageService)
          .confirmUpload(key, 'garage_photo', 'acc_1'),
      ).rejects.toThrow();
      expect(store.objects.has(key)).toBe(true);
    });
  });

  describe('download addresses', () => {
    const key = `legal_document/acc_1/${FINAL_ID}`;

    beforeEach(() => store.put(key, PDF, 'application/pdf'));

    async function disposition(
      name: string | undefined,
      kind: 'inline' | 'attachment' = 'attachment',
    ) {
      const url = await storage.createDownloadUrl(key, name, kind, 5);
      const res = await fetch(url);
      return {
        header: res.headers.get('content-disposition') ?? '',
        queryValue:
          new URL(url).searchParams.get('response-content-disposition') ?? '',
        status: res.status,
      };
    }

    it.each([
      ['a carriage return and line feed', 'a.pdf\r\nSet-Cookie: x=1'],
      ['a bare line feed', 'a\n.pdf'],
      ['a bare carriage return', 'a\r.pdf'],
      ['a null byte', 'a\u0000.pdf'],
      ['a vertical tab and a form feed', 'a\u000b\u000c.pdf'],
      ['a delete character', 'a\u007f.pdf'],
      ['a unicode line separator', 'a b.pdf'],
    ])('keeps a file name with %s on a single header line', async (_, name) => {
      const { header, queryValue, status } = await disposition(name);

      expect(status).toBe(200);
      expect(queryValue).not.toMatch(/[\r\n]/);
      expect(queryValue).not.toContain(String.fromCharCode(0));
      expect(header).toMatch(
        /^attachment; filename="[^"\\]*"; filename\*=UTF-8''[A-Za-z0-9%._~-]*$/,
      );
      expect(header).not.toMatch(/[\r\n]/);
    });

    it('does not let a quote end the quoted name early', async () => {
      const { header } = await disposition('a"; filename="evil.exe');

      expect(header.match(/filename="/g)).toHaveLength(1);
      expect(header).not.toContain('"; filename="evil');
    });

    it('does not let a path in the name through', async () => {
      const { header } = await disposition('../../etc/passwd');

      expect(header).not.toContain('/');
      expect(header).not.toContain('\\');
    });

    it('keeps a name made only of removed characters as a valid header', async () => {
      const { header, status } = await disposition('"/\\\r\n');

      expect(status).toBe(200);
      expect(header).toMatch(
        /^attachment(; filename="[^"]*"; filename\*=UTF-8''[A-Za-z0-9%._~-]*)?$/,
      );
    });

    it('keeps a long name with non-ASCII letters serving the file', async () => {
      const { header, status } = await disposition(`${'ș'.repeat(150)}.pdf`);

      expect(status).toBe(200);
      expect(header).toContain("filename*=UTF-8''%C8%99");
    });

    it('percent-encodes a percent sign and a semicolon in the extended name', async () => {
      const { header } = await disposition('100%;x.pdf');

      expect(header).toContain("filename*=UTF-8''100%25%3Bx.pdf");
    });

    it('treats an empty name as no name', async () => {
      const { header } = await disposition('', 'inline');

      expect(header).toBe('inline');
    });

    it('serves a key with spaces, question marks, hashes and unicode', async () => {
      const odd = 'legal_document/acc_1/a b?c#d é';
      store.put(odd, PDF, 'application/pdf');

      const res = await fetch(
        await storage.createDownloadUrl(odd, undefined, 'inline', 5),
      );

      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer())).toEqual(PDF);
    });

    it('does not open a sibling key that shares a prefix', async () => {
      const sibling = `${key}2`;
      store.put(sibling, PDF, 'application/pdf');
      const url = await storage.createDownloadUrl(key, 'a.pdf', 'inline', 5);

      expect((await fetch(url.replace(key, sibling))).status).toBe(403);
    });

    it('does not let the disposition be changed by editing the address', async () => {
      const url = await storage.createDownloadUrl(key, 'a.pdf', 'inline', 5);
      const tampered = new URL(url);
      tampered.searchParams.set('response-content-disposition', 'attachment');

      expect((await fetch(tampered)).status).toBe(403);
    });

    it('does not let the lifetime be extended by editing the address', async () => {
      const url = await storage.createDownloadUrl(key, 'a.pdf', 'inline', 5);
      const tampered = new URL(url);
      tampered.searchParams.set('X-Amz-Expires', '604800');
      store.now = () => Date.now() + 6 * MINUTE;

      expect((await fetch(tampered)).status).toBe(403);
    });

    it.each([
      ['zero', 0],
      ['negative', -5],
      ['not a number', Number.NaN],
      ['infinite', Number.POSITIVE_INFINITY],
    ])('refuses to sign for a lifetime that is %s', async (_, minutes) => {
      await expect(
        storage.createDownloadUrl(key, undefined, 'inline', minutes),
      ).rejects.toThrow();
    });

    it('signs for a one-minute lifetime and stops after it', async () => {
      const url = await storage.createDownloadUrl(key, undefined, 'inline', 1);

      store.now = () => Date.now() + 30_000;
      expect((await fetch(url)).status).toBe(200);
      store.now = () => Date.now() + 2 * MINUTE;
      expect((await fetch(url)).status).toBe(403);
    });

    it('signs offline for a key that holds no object and the store answers 404', async () => {
      const url = await storage.createDownloadUrl(
        'legal_document/acc_1/none',
        undefined,
        'inline',
        5,
      );

      expect((await fetch(url)).status).toBe(404);
    });
  });

  describe('server writes and deletes', () => {
    it.each([
      ['an empty buffer', Buffer.alloc(0), Buffer.alloc(0)],
      ['an empty string', '', Buffer.alloc(0)],
      [
        'a string with unicode',
        'Factură Șerban',
        Buffer.from('Factură Șerban'),
      ],
      ['a byte array', new Uint8Array([0, 255, 1]), Buffer.from([0, 255, 1])],
      [
        'binary with null bytes',
        Buffer.from([0, 0, 0]),
        Buffer.from([0, 0, 0]),
      ],
    ])('writes %s byte for byte', async (_, body, expected) => {
      await storage.putObject(
        'exports/gar_1/x',
        body,
        'application/octet-stream',
      );

      expect(store.objects.get('exports/gar_1/x')?.body).toEqual(expected);
      expect(store.objects.get('exports/gar_1/x')?.contentType).toBe(
        'application/octet-stream',
      );
    });

    it('writes a few megabytes in one call', async () => {
      const big = Buffer.alloc(12 * 1024 * 1024, 7);

      await storage.putObject('exports/gar_1/big', big, 'application/pdf');

      expect(store.objects.get('exports/gar_1/big')?.body.length).toBe(
        big.length,
      );
    });

    it('replaces an object written twice to the same key', async () => {
      await storage.putObject('exports/gar_1/x', 'one', 'text/plain');
      await storage.putObject('exports/gar_1/x', 'two', 'text/plain');

      expect(store.objects.get('exports/gar_1/x')?.body.toString()).toBe('two');
      expect(store.objects.size).toBe(1);
    });

    it('writes and deletes a key with spaces and unicode', async () => {
      await storage.putObject('exports/gar 1/é ü', 'x', 'text/plain');
      expect([...store.objects.keys()]).toEqual(['exports/gar 1/é ü']);

      await storage.deleteObject('exports/gar 1/é ü');

      expect(store.objects.size).toBe(0);
    });

    it('deletes only the named key and not its neighbours or its prefix', async () => {
      store.put('garage_photo/acc_1/a', JPEG, 'image/jpeg');
      store.put('garage_photo/acc_1/a/b', JPEG, 'image/jpeg');
      store.put('garage_photo/acc_1/ab', JPEG, 'image/jpeg');

      await storage.deleteObject('garage_photo/acc_1/a');

      expect([...store.objects.keys()].sort()).toEqual([
        'garage_photo/acc_1/a/b',
        'garage_photo/acc_1/ab',
      ]);
    });

    it('deletes a key that never existed, many times over', async () => {
      await Promise.all(
        Array.from({ length: 5 }, () => storage.deleteObject('never/was/here')),
      );

      expect(store.objects.size).toBe(0);
    });

    it('fails a write when the store is unreachable', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          StorageModule.register({
            ...store.env(),
            STORAGE_ENDPOINT: 'http://127.0.0.1:1',
          }),
        ],
      }).compile();

      await expect(
        moduleRef.get(StorageService).putObject('a/b', 'x', 'text/plain'),
      ).rejects.toThrow();
    });
  });

  describe('ready check', () => {
    const sockets = new Set<Socket>();
    let silent: Server | undefined;

    afterEach(async () => {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await new Promise<void>((resolve) =>
        silent ? silent.close(() => resolve()) : resolve(),
      );
      silent = undefined;
    });

    it('rejects when the credentials are wrong', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          StorageModule.register({
            ...store.env(),
            STORAGE_ACCESS_KEY_ID: 'someone-else',
          }),
        ],
      }).compile();

      await expect(moduleRef.get(StorageService).ready()).rejects.toThrow();
    });

    it('rejects when the bucket does not exist', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          StorageModule.register({
            ...store.env(),
            STORAGE_BUCKET: 'elsewhere',
          }),
        ],
      }).compile();

      await expect(moduleRef.get(StorageService).ready()).rejects.toThrow();
    });

    it('rejects within seconds when the store accepts the connection and never answers', async () => {
      silent = createServer(() => undefined);
      silent.on('connection', (socket) => sockets.add(socket));
      await new Promise<void>((resolve) =>
        silent?.listen(0, '127.0.0.1', resolve),
      );
      const { port } = (silent as Server).address() as AddressInfo;
      const moduleRef = await Test.createTestingModule({
        imports: [
          StorageModule.register({
            ...store.env(),
            STORAGE_ENDPOINT: `http://127.0.0.1:${port}`,
          }),
        ],
      }).compile();

      const started = Date.now();
      await expect(moduleRef.get(StorageService).ready()).rejects.toThrow();

      expect(Date.now() - started).toBeLessThan(5000);
    }, 15_000);
  });
});
