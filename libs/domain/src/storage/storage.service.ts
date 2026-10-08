import { randomUUID } from 'node:crypto';

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  FILE_RULES,
  type FilePurpose,
  type FileRule,
  type StorageEnv,
  UPLOAD_URL_MINUTES,
} from '@motor-fix/contracts';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  UnprocessableEntityException,
} from '@nestjs/common';

export const STORAGE_OPTIONS = Symbol('STORAGE_OPTIONS');

const FILE_COPIES = ['thumb', 'display'] as const;
export type FileCopy = (typeof FILE_COPIES)[number];

export interface SignedUpload {
  expiresAt: string;
  fields: Record<string, string>;
  key: string;
  url: string;
}

const READY_LIMIT_MS = 2000;
const OWNER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const RANDOM_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ascii = (head: Uint8Array, from: number, to: number) =>
  Buffer.from(head.subarray(from, to)).toString('latin1');

// What a file of each type starts with; a renamed executable fails here.
const SIGNATURES: Record<string, (head: Uint8Array) => boolean> = {
  'application/pdf': (head) => ascii(head, 0, 5) === '%PDF-',
  'image/jpeg': (head) =>
    head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
  'image/png': (head) => PNG.equals(head.subarray(0, 8)),
  'image/webp': (head) =>
    ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP',
};

const missing = () =>
  new ConflictException({
    code: 'file_missing',
    message: 'No uploaded file waits at this key',
  });

const statusOf = (error: unknown) =>
  error instanceof S3ServiceException
    ? error.$metadata.httpStatusCode
    : undefined;

// RFC 6266: an ASCII name for old clients and the exact name in filename*.
// Quotes, slashes and control characters (CR and LF among them) go first, so
// a name can neither break out of the header nor point at a path.
function contentDisposition(
  disposition: 'attachment' | 'inline',
  fileName: string | undefined,
) {
  const name = fileName?.replace(/["/\\\p{Cc}]/gu, '');
  if (!name) return disposition;
  const fallback = name.replace(/[^\x20-\x7e]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

// Storage never decides who may upload or see a file: the owning use case
// checks the caller first and only then asks for an address.
@Injectable()
export class StorageService implements OnApplicationShutdown {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly logger = new Logger(StorageService.name);

  constructor(@Inject(STORAGE_OPTIONS) env: StorageEnv) {
    this.bucket = env.STORAGE_BUCKET;
    this.s3 = new S3Client({
      credentials: {
        accessKeyId: env.STORAGE_ACCESS_KEY_ID,
        secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
      },
      endpoint: env.STORAGE_ENDPOINT,
      forcePathStyle: true,
      region: env.STORAGE_REGION,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      requestHandler: { connectionTimeout: 2000, requestTimeout: 30_000 },
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async createUpload(
    purpose: FilePurpose,
    ownerRef: string,
    contentType: string,
    size: number,
  ): Promise<SignedUpload> {
    const rule = this.rule(purpose, ownerRef);
    if (!Number.isInteger(size) || size < 1) {
      throw new BadRequestException({
        code: 'validation_failed',
        message: 'size must be a positive whole number of bytes',
      });
    }
    if (!rule.types.includes(contentType)) {
      throw new UnprocessableEntityException({
        code: 'file_type_not_allowed',
        message: `${purpose} takes ${rule.types.join(', ')}`,
      });
    }
    if (size > rule.maxBytes) throw this.tooLarge(purpose, rule);

    const key = `incoming/${purpose}/${ownerRef}/${randomUUID()}`;
    const seconds = UPLOAD_URL_MINUTES * 60;
    const { url, fields } = await createPresignedPost(this.s3, {
      Bucket: this.bucket,
      Conditions: [
        ['content-length-range', 1, size],
        ['eq', '$Content-Type', contentType],
      ],
      Expires: seconds,
      Fields: { 'Content-Type': contentType },
      Key: key,
    });
    const expiresAt = new Date(Date.now() + seconds * 1000).toISOString();
    return { expiresAt, fields, key, url };
  }

  async confirmUpload(
    key: string,
    purpose: FilePurpose,
    ownerRef: string,
  ): Promise<string> {
    const rule = this.rule(purpose, ownerRef);
    const prefix = `incoming/${purpose}/${ownerRef}/`;
    const id = key.slice(prefix.length);
    if (!key.startsWith(prefix) || !RANDOM_ID.test(id)) throw missing();

    const head = await this.s3
      .send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      .catch((error: unknown) => {
        throw statusOf(error) === 404 ? missing() : error;
      });
    if ((head.ContentLength ?? 0) > rule.maxBytes) {
      await this.discard(key);
      throw this.tooLarge(purpose, rule);
    }
    const type = head.ContentType ?? '';
    const matches =
      rule.types.includes(type) &&
      (head.ContentLength ?? 0) > 0 &&
      SIGNATURES[type]?.(await this.firstBytes(key));
    if (!matches) {
      await this.discard(key);
      throw new UnprocessableEntityException({
        code: 'file_type_mismatch',
        message: `The file is not the ${type} it was declared as`,
      });
    }

    const finalKey = `${purpose}/${ownerRef}/${id}`;
    // A form stays valid for its whole lifetime, so it can be posted again
    // after its file was confirmed; a confirmed file is never replaced.
    if (await this.exists(finalKey)) throw missing();
    // The upload address is still valid while this runs; the ETag pins the
    // copy to the object that was checked, not one swapped in since.
    await this.s3
      .send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          CopySource: `${this.bucket}/${key}`,
          CopySourceIfMatch: head.ETag,
          Key: finalKey,
        }),
      )
      .catch((error: unknown) => {
        const status = statusOf(error);
        throw status === 404 || status === 412 ? missing() : error;
      });
    await this.discard(key);
    return finalKey;
  }

  createDownloadUrl(
    key: string,
    fileName: string | undefined,
    disposition: 'attachment' | 'inline',
    minutes: number,
  ): Promise<string> {
    if (disposition !== 'inline' && disposition !== 'attachment') {
      return Promise.reject(
        new RangeError('a file is served inline or as an attachment'),
      );
    }
    if (!(minutes > 0 && Number.isFinite(minutes))) {
      return Promise.reject(
        new RangeError('a download address lives a positive number of minutes'),
      );
    }
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: contentDisposition(disposition, fileName),
      }),
      { expiresIn: minutes * 60 },
    );
  }

  async putObject(
    key: string,
    body: Buffer | Uint8Array | string,
    contentType: string,
    metadata?: Record<string, string>,
  ): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Body: body,
        Bucket: this.bucket,
        ContentType: contentType,
        Key: key,
        Metadata: metadata,
      }),
    );
  }

  async readObject(key: string): Promise<Buffer> {
    const object = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return Buffer.from((await object.Body?.transformToByteArray()) ?? []);
  }

  // Null when nothing is stored at the key.
  metadataOf(key: string): Promise<Record<string, string> | null> {
    return this.s3
      .send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      .then(
        (head) => head.Metadata ?? {},
        (error: unknown) => {
          if (statusOf(error) === 404) return null;
          throw error;
        },
      );
  }

  derivedKey(key: string, copy: FileCopy): string {
    return `${key}.${copy}`;
  }

  // A file goes with every copy made from it; S3 answers a delete of a
  // missing key with success, so copies never made cost nothing.
  async deleteWithCopies(key: string): Promise<void> {
    await Promise.all(
      [key, ...FILE_COPIES.map((copy) => this.derivedKey(key, copy))].map(
        (each) => this.deleteObject(each),
      ),
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async ready(): Promise<void> {
    await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }), {
      abortSignal: AbortSignal.timeout(READY_LIMIT_MS),
    });
  }

  onApplicationShutdown() {
    this.s3.destroy();
  }

  private rule(purpose: FilePurpose, ownerRef: string): FileRule {
    if (!Object.hasOwn(FILE_RULES, purpose) || !OWNER_ID.test(ownerRef)) {
      throw new BadRequestException({
        code: 'validation_failed',
        message: 'unknown file purpose or malformed owner id',
      });
    }
    return FILE_RULES[purpose];
  }

  private tooLarge(purpose: FilePurpose, rule: FileRule) {
    return new UnprocessableEntityException({
      code: 'file_too_large',
      message: `${purpose} takes at most ${rule.maxBytes} bytes`,
    });
  }

  // The incoming/ life-cycle rule sweeps what this leaves, so a failed delete
  // must not hide the confirm's real outcome from the caller.
  private async discard(key: string): Promise<void> {
    await this.deleteObject(key).catch((error: unknown) => {
      this.logger.warn(`could not delete ${key}: ${String(error)}`);
    });
  }

  private exists(key: string): Promise<boolean> {
    return this.s3
      .send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      .then(
        () => true,
        (error: unknown) => {
          if (statusOf(error) === 404) return false;
          throw error;
        },
      );
  }

  private async firstBytes(key: string): Promise<Uint8Array> {
    const object = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Range: 'bytes=0-11',
      }),
    );
    return (await object.Body?.transformToByteArray()) ?? new Uint8Array();
  }
}
