import { createHash, createHmac, randomUUID } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

import type { StorageEnv } from '@motor-fix/contracts';

interface StoredObject {
  body: Buffer;
  contentType: string;
  etag: string;
}

type Fields = Record<string, string>;
type Condition = Record<string, string> | [string, string, unknown];

class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const hmac = (key: Buffer | string, data: string) =>
  createHmac('sha256', key).update(data).digest();
const sha256 = (data: string) =>
  createHash('sha256').update(data).digest('hex');
const rfc3986 = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

// "20261004T052615Z" → epoch milliseconds
const amzTime = (stamp: string) =>
  Date.parse(
    `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`,
  );

// An S3-protocol server for the specs: one bucket, in memory, path-style.
// It checks what a real store checks for the addresses MotorFix signs — the
// POST policy's signature, expiry and conditions, and a presigned GET's
// signature and lifetime. Header-signed SDK calls are only checked for the
// access key: their signing is the SDK's, and no MotorFix code shapes it.
export class S3TestStore {
  readonly objects = new Map<string, StoredObject>();
  now = () => Date.now();
  beforeCopy: (() => void) | undefined;
  beforeDelete: (() => void) | undefined;
  private readonly server: Server = createServer((req, res) =>
    this.handle(req, res).catch((error: unknown) => {
      const refusal =
        error instanceof Refusal ? error : new Refusal(500, 'InternalError');
      res.writeHead(refusal.status, { 'content-type': 'application/xml' });
      res.end(
        `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${refusal.code}</Code><Message>${refusal.code}</Message></Error>`,
      );
    }),
  );
  private endpoint = '';

  constructor(
    readonly bucket = 'motorfix',
    private readonly accessKeyId = 'test-key',
    private readonly secretAccessKey = 'test-secret',
  ) {}

  async start(): Promise<void> {
    await new Promise<void>((resolve) =>
      this.server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = this.server.address() as AddressInfo;
    this.endpoint = `http://127.0.0.1:${port}`;
  }

  stop(): Promise<void> {
    this.server.closeAllConnections();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  env(): StorageEnv {
    return {
      STORAGE_ACCESS_KEY_ID: this.accessKeyId,
      STORAGE_BUCKET: this.bucket,
      STORAGE_ENDPOINT: this.endpoint,
      STORAGE_REGION: 'eu-central-1',
      STORAGE_SECRET_ACCESS_KEY: this.secretAccessKey,
    };
  }

  put(key: string, body: Buffer, contentType: string) {
    this.objects.set(key, { body, contentType, etag: `"${randomUUID()}"` });
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://store');
    const [, bucket, ...rest] = url.pathname.split('/');
    if (bucket !== this.bucket) throw new Refusal(404, 'NoSuchBucket');
    const key = decodeURIComponent(rest.join('/'));
    const body = await read(req);

    if (url.searchParams.has('X-Amz-Signature')) this.checkPresigned(req, url);
    else if (req.method !== 'POST') this.checkHeaderAuth(req);

    if (!key) this.onBucket(req, body, res);
    else if (req.method === 'PUT') this.putObject(req, key, body, res);
    else if (req.method === 'DELETE') {
      this.beforeDelete?.();
      this.objects.delete(key);
      res.writeHead(204).end();
    } else this.getObject(req, url, key, res);
  }

  private onBucket(req: IncomingMessage, body: Buffer, res: ServerResponse) {
    if (req.method === 'POST') this.postForm(req, body);
    else if (req.method !== 'HEAD') throw new Refusal(405, 'MethodNotAllowed');
    res.writeHead(req.method === 'POST' ? 204 : 200).end();
  }

  private checkHeaderAuth(req: IncomingMessage) {
    const auth = req.headers.authorization ?? '';
    if (!auth.startsWith(`AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/`)) {
      throw new Refusal(403, 'AccessDenied');
    }
  }

  private signingKey(scope: string) {
    const [date, region, service] = scope.split('/');
    return hmac(
      hmac(hmac(hmac(`AWS4${this.secretAccessKey}`, date), region), service),
      'aws4_request',
    );
  }

  private checkPresigned(req: IncomingMessage, url: URL) {
    const q = url.searchParams;
    const credential = q.get('X-Amz-Credential') ?? '';
    const amzDate = q.get('X-Amz-Date') ?? '';
    const [accessKey, ...scopeParts] = credential.split('/');
    const scope = scopeParts.join('/');
    if (accessKey !== this.accessKeyId) throw new Refusal(403, 'AccessDenied');
    const expires = Number(q.get('X-Amz-Expires'));
    if (this.now() > amzTime(amzDate) + expires * 1000) {
      throw new Refusal(403, 'AccessDenied');
    }
    const query = [...q.entries()]
      .filter(([name]) => name !== 'X-Amz-Signature')
      .map(([name, value]) => `${rfc3986(name)}=${rfc3986(value)}`)
      .sort()
      .join('&');
    const signedHeaders = q.get('X-Amz-SignedHeaders') ?? '';
    const headers = signedHeaders
      .split(';')
      .map((name) => `${name}:${String(req.headers[name] ?? '').trim()}\n`)
      .join('');
    const canonical = [
      req.method,
      url.pathname,
      query,
      headers,
      signedHeaders,
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join(
      '\n',
    );
    const signature = hmac(this.signingKey(scope), toSign).toString('hex');
    if (signature !== q.get('X-Amz-Signature')) {
      throw new Refusal(403, 'SignatureDoesNotMatch');
    }
  }

  private postForm(req: IncomingMessage, body: Buffer) {
    const { fields, file } = parseMultipart(req, body);
    const form: Fields = { bucket: this.bucket };
    for (const [name, value] of Object.entries(fields)) {
      form[name.toLowerCase()] = value;
    }
    // Every field the browser sends must be named by a condition.
    const covered = new Set(['policy', 'x-amz-signature', 'file', 'bucket']);
    for (const condition of this.policyConditions(form)) {
      for (const field of checkCondition(condition, form, file)) {
        covered.add(field);
      }
    }
    if (
      Object.keys(form).some(
        (name) => !covered.has(name) && !name.startsWith('x-ignore-'),
      )
    ) {
      throw new Refusal(403, 'AccessDenied');
    }
    this.put(form['key'], file, form['content-type'] ?? 'binary/octet-stream');
  }

  private policyConditions(form: Fields): Condition[] {
    const scope = form['x-amz-credential']?.split('/').slice(1).join('/');
    const policy = form['policy'] ?? '';
    const signature = hmac(this.signingKey(scope ?? ''), policy).toString(
      'hex',
    );
    if (!scope || signature !== form['x-amz-signature']) {
      throw new Refusal(403, 'SignatureDoesNotMatch');
    }
    const document = JSON.parse(Buffer.from(policy, 'base64').toString()) as {
      conditions: Condition[];
      expiration: string;
    };
    if (this.now() > Date.parse(document.expiration)) {
      throw new Refusal(403, 'AccessDenied');
    }
    return document.conditions;
  }

  private putObject(
    req: IncomingMessage,
    key: string,
    body: Buffer,
    res: ServerResponse,
  ) {
    const copySource = req.headers['x-amz-copy-source'];
    if (typeof copySource !== 'string') {
      this.put(key, body, req.headers['content-type'] ?? 'binary/octet-stream');
      res.writeHead(200, { etag: this.objects.get(key)?.etag }).end();
      return;
    }
    this.beforeCopy?.();
    const sourceKey = decodeURIComponent(copySource)
      .replace(/^\//, '')
      .slice(this.bucket.length + 1);
    const source = this.objects.get(sourceKey);
    if (!source) throw new Refusal(404, 'NoSuchKey');
    const ifMatch = req.headers['x-amz-copy-source-if-match'];
    if (ifMatch && ifMatch !== source.etag) {
      throw new Refusal(412, 'PreconditionFailed');
    }
    this.put(key, source.body, source.contentType);
    res
      .writeHead(200, { 'content-type': 'application/xml' })
      .end(
        `<?xml version="1.0" encoding="UTF-8"?><CopyObjectResult><ETag>${this.objects.get(key)?.etag}</ETag><LastModified>${new Date().toISOString()}</LastModified></CopyObjectResult>`,
      );
  }

  private getObject(
    req: IncomingMessage,
    url: URL,
    key: string,
    res: ServerResponse,
  ) {
    const object = this.objects.get(key);
    if (!object) {
      if (req.method !== 'HEAD') throw new Refusal(404, 'NoSuchKey');
      res.writeHead(404).end();
      return;
    }
    const headers: Record<string, string> = {
      'content-type': object.contentType,
      etag: object.etag,
    };
    const disposition = url.searchParams.get('response-content-disposition');
    if (disposition) headers['content-disposition'] = disposition;
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '');
    const body = range
      ? object.body.subarray(Number(range[1]), Number(range[2]) + 1)
      : object.body;
    headers['content-length'] = String(
      req.method === 'HEAD' ? object.body.length : body.length,
    );
    if (range) {
      headers['content-range'] =
        `bytes ${range[1]}-${Number(range[1]) + body.length - 1}/${object.body.length}`;
    }
    res.writeHead(range ? 206 : 200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  }
}

function read(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Returns the form fields the condition names.
function checkCondition(
  condition: Condition,
  form: Fields,
  file: Buffer,
): string[] {
  if (!Array.isArray(condition)) {
    const names = Object.keys(condition).map((name) => name.toLowerCase());
    if (Object.values(condition).some((value, i) => form[names[i]] !== value)) {
      throw new Refusal(403, 'AccessDenied');
    }
    return names;
  }
  const [operator, name, value] = condition;
  if (operator === 'content-length-range') {
    checkLength(file, Number(name), Number(value));
    return [];
  }
  const field = name.replace(/^\$/, '').toLowerCase();
  const actual = form[field] ?? '';
  const ok =
    operator === 'eq'
      ? actual === value
      : operator === 'starts-with' && actual.startsWith(String(value));
  if (!ok) throw new Refusal(403, 'AccessDenied');
  return [field];
}

function checkLength(file: Buffer, min: number, max: number) {
  if (file.length < min) throw new Refusal(400, 'EntityTooSmall');
  if (file.length > max) throw new Refusal(400, 'EntityTooLarge');
}

function parseMultipart(req: IncomingMessage, body: Buffer) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(
    req.headers['content-type'] ?? '',
  );
  if (!boundary) throw new Refusal(400, 'MalformedPOSTRequest');
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const fields: Fields = {};
  let file: Buffer | undefined;
  let start = body.indexOf(delimiter) + delimiter.length;
  let end = body.indexOf(delimiter, start);
  while (start >= delimiter.length && end >= 0) {
    const { content, name } = parsePart(body.subarray(start + 2, end - 2));
    if (name === 'file') file = content;
    else if (name) fields[name] = content.toString();
    start = end + delimiter.length;
    end = body.indexOf(delimiter, start);
  }
  if (!file) throw new Refusal(400, 'InvalidArgument');
  return { fields, file };
}

function parsePart(part: Buffer) {
  const split = part.indexOf('\r\n\r\n');
  const head = part.subarray(0, split).toString();
  return {
    content: part.subarray(split + 4),
    name: /name="([^"]*)"/.exec(head)?.[1],
  };
}
