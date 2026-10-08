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

const KEY = 'incoming/garage_photo/acc_1/0b5f3c1e-0000-4000-8000-000000000000';

// Storage calls run inside a request or a job; the sampler drops a client
// span nothing started (setup/sampler.ts).
function call(
  commandName: string,
  next: () => Promise<unknown> = async () => ({ output: {} }),
) {
  const middleware = storageTelemetry('motorfix');
  if (!middleware) throw new Error('telemetry is on in this spec');
  const handler = middleware(next as never, { commandName } as never);
  return trace
    .getTracer('spec')
    .startActiveSpan('job', { kind: SpanKind.CONSUMER }, (job) =>
      handler({ input: { Bucket: 'motorfix', Key: KEY } } as never).finally(
        () => job.end(),
      ),
    );
}

const s3Error = (status: number, name: string) =>
  new S3ServiceException({
    $fault: status < 500 ? 'client' : 'server',
    $metadata: { httpStatusCode: status },
    message: name,
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

// @traces 878-FR-010
// @traces 878-FR-012
describe('storageTelemetry', () => {
  it('makes each call a client span named after the operation, with the bucket and never the key', async () => {
    await call('PutObjectCommand');

    const [span] = await spans();
    expect(span?.name).toBe('S3 PutObject');
    expect(span?.kind).toBe(SpanKind.CLIENT);
    expect(span?.attributes).toEqual({
      'aws.s3.bucket': 'motorfix',
      'rpc.method': 'PutObject',
      'rpc.service': 'S3',
      'rpc.system': 'aws-api',
    });
    expect(JSON.stringify(span?.attributes)).not.toContain('garage_photo');
    expect(span?.status.code).toBe(SpanStatusCode.UNSET);
  });

  it('makes the span a child of the active one', async () => {
    await call('GetObjectCommand');

    await started?.flush();
    const all = memory.spanExporter.getFinishedSpans();
    const parent = all.find((span) => span.name === 'job');
    const child = all.find((span) => span.name === 'S3 GetObject');
    expect(parent).toBeDefined();
    expect(child?.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId);
  });

  it('counts a call that answered as ok and records its duration by operation', async () => {
    const before = await count('HeadBucket', 'ok');
    await call('HeadBucketCommand');

    expect(await count('HeadBucket', 'ok')).toBe(before + 1);
    const [duration] = (
      await points('motorfix_storage_request_duration_seconds')
    ).filter((point) => point.attributes['operation'] === 'HeadBucket');
    expect(duration?.attributes).toEqual({ operation: 'HeadBucket' });
    expect(
      (duration?.value as Histogram | undefined)?.count,
    ).toBeGreaterThanOrEqual(1);
  });

  it('ends the span in error, counts an error and rethrows the same rejection', async () => {
    const failure = s3Error(503, 'SlowDown');
    const before = await count('CopyObject', 'error');

    await expect(
      call('CopyObjectCommand', () => Promise.reject(failure)),
    ).rejects.toBe(failure);

    const [span] = await spans();
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(span?.events.map((event) => event.name)).toContain('exception');
    expect(await count('CopyObject', 'error')).toBe(before + 1);
  });

  it('treats a rejection that is not an S3 answer as an error too', async () => {
    const failure = new Error('socket hang up');
    await expect(
      call('DeleteObjectCommand', () => Promise.reject(failure)),
    ).rejects.toBe(failure);

    const [span] = await spans();
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
  });

  it('counts a 404 answer as ok and leaves the span status unset, still rethrowing it', async () => {
    const notFound = s3Error(404, 'NotFound');
    const before = await count('HeadObject', 'ok');

    await expect(
      call('HeadObjectCommand', () => Promise.reject(notFound)),
    ).rejects.toBe(notFound);

    const [span] = await spans();
    expect(span?.status.code).toBe(SpanStatusCode.UNSET);
    expect(await count('HeadObject', 'ok')).toBe(before + 1);
  });
});
