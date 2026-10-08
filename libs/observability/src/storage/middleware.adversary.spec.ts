import { S3ServiceException } from '@aws-sdk/client-s3';
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { DataPoint, Histogram } from '@opentelemetry/sdk-metrics';

import { storageTelemetry } from './middleware';
import { startTelemetry } from '../setup/start';
import { inMemory } from '../testing/in-memory';

const memory = inMemory();
const started = startTelemetry(
  'worker',
  { APP_ENV: 'staging', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);
afterAll(() => started?.shutdown());
beforeEach(async () => {
  await started?.flush();
  memory.spanExporter.reset();
});

const KEY = 'incoming/garage_photo/acc_1/zz-secret-key-ț.jpg';

function call(
  commandName: string | undefined,
  next: () => Promise<unknown> = async () => ({ output: {} }),
  input: unknown = { Bucket: 'motorfix', Key: KEY },
) {
  const middleware = storageTelemetry('motorfix');
  if (!middleware) throw new Error('telemetry is on in this spec');
  const handler = middleware(next as never, { commandName } as never);
  return trace
    .getTracer('spec')
    .startActiveSpan('job', { kind: SpanKind.CONSUMER }, (job) =>
      Promise.resolve()
        .then(() => handler({ input } as never))
        .finally(() => job.end()),
    );
}

const s3Error = (status: number, name: string, message = name) =>
  new S3ServiceException({
    $fault: status < 500 ? 'client' : 'server',
    $metadata: { httpStatusCode: status },
    message,
    name,
  });

async function spans() {
  await started?.flush();
  return memory.spanExporter
    .getFinishedSpans()
    .filter((span) => span.name.startsWith('S3 '));
}
async function points(name: string) {
  const { resourceMetrics } = await memory.metricReader.collect();
  return resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .filter((metric) => metric.descriptor.name === name)
    .flatMap((metric) => metric.dataPoints as DataPoint<unknown>[]);
}
const count = async (operation: string, outcome: string) =>
  Number(
    (await points('motorfix_storage_requests_total')).find(
      (point) =>
        point.attributes['operation'] === operation &&
        point.attributes['outcome'] === outcome,
    )?.value ?? 0,
  );

describe('storageTelemetry with odd errors', () => {
  it('rethrows an error with no $metadata unchanged and counts it as an error', async () => {
    const failure = Object.assign(new Error('NotFound'), { name: 'NotFound' });
    const before = await count('HeadObject', 'error');
    await expect(
      call('HeadObjectCommand', () => Promise.reject(failure)),
    ).rejects.toBe(failure);
    expect(await count('HeadObject', 'error')).toBe(before + 1);
    expect((await spans())[0]?.status.code).toBe(SpanStatusCode.ERROR);
  });

  it('rethrows an S3ServiceException whose $metadata was stripped', async () => {
    const failure = s3Error(404, 'NotFound');
    Object.assign(failure, { $metadata: undefined });
    await expect(
      call('HeadObjectCommand', () => Promise.reject(failure)),
    ).rejects.toBe(failure);
  });

  it('survives a rejection with undefined or null and counts an error', async () => {
    for (const reason of [undefined, null]) {
      const before = await count('GetObject', 'error');
      await expect(
        call('GetObjectCommand', () => Promise.reject(reason)),
      ).rejects.toBe(reason);
      expect(await count('GetObject', 'error')).toBe(before + 1);
    }
  });

  it('survives a rejection with a string and a plain object', async () => {
    await expect(
      call('GetObjectCommand', () => Promise.reject('nope')),
    ).rejects.toBe('nope');
    const plain = { $metadata: { httpStatusCode: 500 } };
    await expect(
      call('GetObjectCommand', () => Promise.reject(plain)),
    ).rejects.toBe(plain);
  });

  it('counts a handler that throws synchronously as an error and ends the span', async () => {
    const failure = new Error('sync');
    const before = await count('PutObject', 'error');
    await expect(
      call('PutObjectCommand', () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await count('PutObject', 'error')).toBe(before + 1);
    expect((await spans())[0]?.status.code).toBe(SpanStatusCode.ERROR);
  });
});

describe('storageTelemetry status codes', () => {
  it('counts a 404 as ok with an unset span status for NoSuchKey and NoSuchBucket', async () => {
    for (const name of ['NoSuchKey', 'NoSuchBucket']) {
      memory.spanExporter.reset();
      const before = await count('GetObject', 'ok');
      await expect(
        call('GetObjectCommand', () => Promise.reject(s3Error(404, name))),
      ).rejects.toThrow();
      expect(await count('GetObject', 'ok')).toBe(before + 1);
      expect((await spans())[0]?.status.code).toBe(SpanStatusCode.UNSET);
    }
  });

  it.each([400, 401, 403, 409, 429, 500, 503])(
    'counts a %s as an error with the span in error',
    async (status) => {
      const before = await count('HeadObject', 'error');
      await expect(
        call('HeadObjectCommand', () =>
          Promise.reject(s3Error(status, 'Denied')),
        ),
      ).rejects.toThrow();
      expect(await count('HeadObject', 'error')).toBe(before + 1);
      expect((await spans())[0]?.status.code).toBe(SpanStatusCode.ERROR);
    },
  );

  it('keeps a 403 apart from a 404 on the same operation', async () => {
    const ok = await count('HeadObject', 'ok');
    const error = await count('HeadObject', 'error');
    await call('HeadObjectCommand', () =>
      Promise.reject(s3Error(404, 'NotFound')),
    ).catch(() => undefined);
    await call('HeadObjectCommand', () =>
      Promise.reject(s3Error(403, 'Forbidden')),
    ).catch(() => undefined);
    expect(await count('HeadObject', 'ok')).toBe(ok + 1);
    expect(await count('HeadObject', 'error')).toBe(error + 1);
  });

  it('records a 404 exception event on no span', async () => {
    await call('HeadObjectCommand', () =>
      Promise.reject(s3Error(404, 'NotFound')),
    ).catch(() => undefined);
    expect((await spans())[0]?.events.map((event) => event.name)).not.toContain(
      'exception',
    );
  });

  it('records the duration of a failed call too', async () => {
    await call('ListObjectsV2Command', () =>
      Promise.reject(s3Error(500, 'Internal')),
    ).catch(() => undefined);
    const duration = (
      await points('motorfix_storage_request_duration_seconds')
    ).find((point) => point.attributes['operation'] === 'ListObjectsV2');
    expect(
      (duration?.value as Histogram | undefined)?.count,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe('storageTelemetry never leaks the key', () => {
  it('keeps the key out of every span attribute and metric attribute on success', async () => {
    await call('PutObjectCommand');
    const [span] = await spans();
    expect(JSON.stringify(span?.attributes)).not.toContain('secret-key');
    const metricText = JSON.stringify(
      [
        ...(await points('motorfix_storage_requests_total')),
        ...(await points('motorfix_storage_request_duration_seconds')),
      ].map((point) => point.attributes),
    );
    expect(metricText).not.toContain('secret-key');
    expect(span?.name).not.toContain('secret-key');
  });

  it('keeps the key out of the span when an error message quotes it', async () => {
    await call('GetObjectCommand', () =>
      Promise.reject(s3Error(500, 'Internal', `failed for ${KEY}`)),
    ).catch(() => undefined);
    const [span] = await spans();
    const text = JSON.stringify({
      attributes: span?.attributes,
      events: span?.events.map((event) => event.attributes),
      status: span?.status,
    });
    expect(text).not.toContain('secret-key');
  });

  it('keeps a Key given as CopySource or in a Delete list out of the attributes', async () => {
    await call('CopyObjectCommand', undefined, {
      Bucket: 'motorfix',
      CopySource: 'motorfix/secret-key-source',
      Key: KEY,
    });
    await call('DeleteObjectsCommand', undefined, {
      Bucket: 'motorfix',
      Delete: { Objects: [{ Key: KEY }] },
    });
    const text = JSON.stringify((await spans()).map((span) => span.attributes));
    expect(text).not.toContain('secret-key');
  });

  it('uses the configured bucket when the input has none, and survives an empty input', async () => {
    await call('ListObjectsV2Command', undefined, {});
    await call('ListObjectsV2Command', undefined, undefined);
    const buckets = (await spans()).map(
      (span) => span.attributes['aws.s3.bucket'],
    );
    expect(buckets).toEqual(['motorfix', 'motorfix']);
  });
});

describe('storageTelemetry operation names', () => {
  it('names the operation without the Command suffix', async () => {
    await call('ListObjectsV2Command');
    expect((await spans())[0]?.name).toBe('S3 ListObjectsV2');
  });

  it('keeps operation a bounded label when the command name is missing', async () => {
    await call(undefined).catch(() => undefined);
    const names = (await points('motorfix_storage_requests_total')).map(
      (point) => String(point.attributes['operation']),
    );
    expect(names).not.toContain('undefined');
  });

  it('counts a hundred parallel calls exactly', async () => {
    const before = await count('GetObject', 'ok');
    await Promise.all(
      Array.from({ length: 100 }, () => call('GetObjectCommand')),
    );
    expect(await count('GetObject', 'ok')).toBe(before + 100);
  });
});
