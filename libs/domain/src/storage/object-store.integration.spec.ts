// @traces 1176-FR-003
import { randomUUID } from 'node:crypto';

import {
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetBucketCorsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { STORAGE_ENV, type StorageEnv } from '@motor-fix/contracts';

import { StorageService } from './storage.service';

// Runs against the object store docker-compose.yml starts; a machine without
// one leaves STORAGE_ENDPOINT unset and the file is skipped.
const endpoint = process.env['STORAGE_ENDPOINT'];
const describeStore = endpoint ? describe : describe.skip;

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('object store round trip'),
]);
const PART = 5 * 1024 * 1024;
const WEB_ORIGIN = 'http://localhost:4200';

function storageEnv(): StorageEnv {
  return Object.fromEntries(
    STORAGE_ENV.map((name) => [name, process.env[name] ?? '']),
  ) as StorageEnv;
}

async function bytesAt(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  expect(response.status).toBe(200);
  return {
    body: Buffer.from(await response.arrayBuffer()),
    headers: response.headers,
  };
}

describeStore(
  `the object store at STORAGE_ENDPOINT (${endpoint ?? 'unset'})`,
  () => {
    const env = storageEnv();
    const bucket = env.STORAGE_BUCKET;
    const owner = `store-${randomUUID().slice(0, 8)}`;
    const written: string[] = [];
    let storage: StorageService;
    let s3: S3Client;

    const read = async (key: string, from = bucket) => {
      const object = await s3.send(
        new GetObjectCommand({ Bucket: from, Key: key }),
      );
      return Buffer.from((await object.Body?.transformToByteArray()) ?? []);
    };

    const postUpload = async () => {
      const upload = await storage.createUpload(
        'garage_photo',
        owner,
        'image/png',
        PNG.length,
      );
      written.push(upload.key);
      const form = new FormData();
      for (const [name, value] of Object.entries(upload.fields)) {
        form.append(name, value);
      }
      form.append('file', new Blob([PNG], { type: 'image/png' }));
      const response = await fetch(upload.url, { body: form, method: 'POST' });
      expect(response.status).toBeLessThan(300);
      return upload.key;
    };

    beforeAll(() => {
      storage = new StorageService(env);
      s3 = new S3Client({
        credentials: {
          accessKeyId: env.STORAGE_ACCESS_KEY_ID,
          secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
        },
        endpoint: env.STORAGE_ENDPOINT,
        forcePathStyle: true,
        region: env.STORAGE_REGION,
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
    });

    afterAll(async () => {
      await Promise.all(
        written.map((key) =>
          s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
        ),
      );
      storage.onApplicationShutdown();
      s3.destroy();
    });

    it('takes a browser upload through a presigned POST policy', async () => {
      const key = await postUpload();

      expect(await read(key)).toEqual(PNG);
    });

    it('copies an upload only while its ETag still matches', async () => {
      const key = await storage.confirmUpload(
        await postUpload(),
        'garage_photo',
        owner,
      );
      written.push(key);

      expect(await read(key)).toEqual(PNG);
    });

    it.each(['inline', 'attachment'] as const)(
      'serves a signed download %s, with its file name',
      async (disposition) => {
        const key = await postUpload();
        const url = await storage.createDownloadUrl(
          key,
          'garage.png',
          disposition,
          5,
        );
        const { body, headers } = await bytesAt(url);

        expect(body).toEqual(PNG);
        expect(headers.get('content-disposition')).toMatch(
          new RegExp(`^${disposition}; filename="garage.png"`),
        );
      },
    );

    it('answers the bucket probe', async () => {
      await expect(storage.ready()).resolves.toBeUndefined();
    });

    it('deletes a file with its copies', async () => {
      const key = await postUpload();
      const keys = [key, storage.derivedKey(key, 'thumb')];
      await storage.putObject(keys[1], PNG, 'image/png');

      await storage.deleteWithCopies(key);

      for (const each of keys) {
        await expect(
          s3.send(new HeadObjectCommand({ Bucket: bucket, Key: each })),
        ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
      }
    });

    it('takes an upload through a presigned PUT', async () => {
      const key = `${owner}/put-${randomUUID()}`;
      written.push(key);
      const url = await getSignedUrl(
        s3,
        new PutObjectCommand({
          Bucket: bucket,
          ContentType: 'image/png',
          Key: key,
        }),
        { expiresIn: 300 },
      );

      const response = await fetch(url, {
        body: PNG,
        headers: { 'content-type': 'image/png' },
        method: 'PUT',
      });

      expect(response.status).toBe(200);
      expect(await read(key)).toEqual(PNG);
    });

    it('takes an upload in presigned parts and puts it back together', async () => {
      const key = `${owner}/multipart-${randomUUID()}`;
      written.push(key);
      const parts = [Buffer.alloc(PART, 1), Buffer.from('the last part')];
      const { UploadId } = await s3.send(
        new CreateMultipartUploadCommand({ Bucket: bucket, Key: key }),
      );

      const uploaded = [];
      for (const [index, body] of parts.entries()) {
        const url = await getSignedUrl(
          s3,
          new UploadPartCommand({
            Bucket: bucket,
            Key: key,
            PartNumber: index + 1,
            UploadId,
          }),
          { expiresIn: 300 },
        );
        const response = await fetch(url, { body, method: 'PUT' });
        expect(response.status).toBe(200);
        uploaded.push({
          ETag: response.headers.get('etag') ?? '',
          PartNumber: index + 1,
        });
      }
      await s3.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          MultipartUpload: { Parts: uploaded },
          UploadId,
        }),
      );

      expect(await read(key)).toEqual(Buffer.concat(parts));
    });

    describe('a bucket with a CORS rule for the web origin', () => {
      const corsBucket = `cors-${randomUUID()}`;
      const rule = {
        AllowedHeaders: ['*'],
        AllowedMethods: ['POST', 'PUT'],
        AllowedOrigins: [WEB_ORIGIN],
        ExposeHeaders: ['ETag'],
      };
      const preflight = (origin: string) =>
        fetch(`${endpoint}/${corsBucket}/photo.png`, {
          headers: {
            'access-control-request-method': 'PUT',
            origin,
          },
          method: 'OPTIONS',
        });

      beforeAll(async () => {
        await s3.send(new CreateBucketCommand({ Bucket: corsBucket }));
        await s3.send(
          new PutBucketCorsCommand({
            Bucket: corsBucket,
            CORSConfiguration: { CORSRules: [rule] },
          }),
        );
      });

      afterAll(async () => {
        await s3.send(new DeleteBucketCommand({ Bucket: corsBucket }));
      });

      it('reads the rule back as it was set', async () => {
        const { CORSRules } = await s3.send(
          new GetBucketCorsCommand({ Bucket: corsBucket }),
        );

        expect(CORSRules).toEqual([expect.objectContaining(rule)]);
      });

      it('lets the web origin upload and read the ETag, and no other origin', async () => {
        const allowed = await preflight(WEB_ORIGIN);
        const foreign = await preflight('http://evil.example');

        expect(allowed.status).toBe(200);
        expect(allowed.headers.get('access-control-allow-origin')).toBe(
          WEB_ORIGIN,
        );
        expect(allowed.headers.get('access-control-expose-headers')).toMatch(
          /etag/i,
        );
        expect(foreign.status).toBe(403);
        expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
      });
    });
  },
);
