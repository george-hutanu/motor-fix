import { startTelemetry } from '@motor-fix/observability';
import { inMemory } from '@motor-fix/observability/testing';
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { DataPoint, Histogram } from '@opentelemetry/sdk-metrics';

import { S3TestStore } from './s3-test-store';
import { StorageService } from './storage.service';

const memory = inMemory();
const started = startTelemetry(
  'worker',
  { APP_ENV: 'staging', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);

const KEY = 'garage_photo/acc_1/2f6a1d6e-1111-4111-8111-111111111111';

// Storage calls run inside a request or a job; the sampler drops a client
// span nothing started.
const inJob = <T>(work: () => Promise<T>) =>
  trace
    .getTracer('spec')
    .startActiveSpan('job', { kind: SpanKind.CONSUMER }, (job) =>
      work().finally(() => job.end()),
    );

async function spans() {
  await started?.flush();
  return memory.spanExporter.getFinishedSpans();
}

async function points(name: string) {
  const { resourceMetrics } = await memory.metricReader.collect();
  return resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .filter((metric) => metric.descriptor.name === name)
    .flatMap((metric) => metric.dataPoints as DataPoint<unknown>[]);
}

// @traces 878-FR-010
describe('StorageService with telemetry on', () => {
  const store = new S3TestStore();
  let storage: StorageService;

  beforeAll(async () => {
    await store.start();
    storage = new StorageService(store.env());
  });
  afterAll(async () => {
    storage.onApplicationShutdown();
    await store.stop();
    await started?.shutdown();
  });
  beforeEach(async () => {
    await started?.flush();
    memory.spanExporter.reset();
  });

  it('makes each object-store call a span named after its operation, with the bucket and never the key', async () => {
    await inJob(async () => {
      await storage.putObject(KEY, 'photo', 'image/jpeg');
      await storage.readObject(KEY);
      await storage.deleteObject(KEY);
      await storage.ready();
    });

    const names = (await spans())
      .map((span) => span.name)
      .filter((name) => name.startsWith('S3 '));
    expect(names).toEqual([
      'S3 PutObject',
      'S3 GetObject',
      'S3 DeleteObject',
      'S3 HeadBucket',
    ]);
    for (const span of await spans()) {
      expect(JSON.stringify(span.attributes)).not.toContain('acc_1');
    }
    const put = (await spans()).find((span) => span.name === 'S3 PutObject');
    expect(put?.attributes).toMatchObject({
      'aws.s3.bucket': 'motorfix',
      'rpc.method': 'PutObject',
    });
  });

  it('counts a missing object as an answered call, not a failure', async () => {
    expect(await inJob(() => storage.metadataOf(`${KEY}.missing`))).toBeNull();

    const head = (await spans()).find((span) => span.name === 'S3 HeadObject');
    expect(head?.status.code).toBe(SpanStatusCode.UNSET);
    const counted = (await points('motorfix_storage_requests_total')).filter(
      (point) => point.attributes['operation'] === 'HeadObject',
    );
    expect(counted.map((point) => point.attributes['outcome'])).toEqual(['ok']);
  });

  it('counts a refused call as an error and ends its span in error', async () => {
    const refused = new StorageService({
      ...store.env(),
      STORAGE_ACCESS_KEY_ID: 'unknown-key',
    });
    await expect(inJob(() => refused.readObject(KEY))).rejects.toThrow();
    refused.onApplicationShutdown();

    const get = (await spans()).find((span) => span.name === 'S3 GetObject');
    expect(get?.status.code).toBe(SpanStatusCode.ERROR);
    const errors = (await points('motorfix_storage_requests_total')).find(
      (point) =>
        point.attributes['operation'] === 'GetObject' &&
        point.attributes['outcome'] === 'error',
    );
    expect(errors?.value).toBe(1);
  });

  it('signs a download address locally without counting it as a call', async () => {
    const before = (await points('motorfix_storage_requests_total'))
      .filter((point) => point.attributes['operation'] === 'GetObject')
      .reduce((sum, point) => sum + Number(point.value), 0);

    const url = await inJob(() =>
      storage.createDownloadUrl(KEY, 'photo.jpg', 'inline', 5),
    );

    expect(url).toContain('X-Amz-Signature=');
    const names = (await spans()).map((span) => span.name);
    expect(names.filter((name) => name.startsWith('S3 '))).toEqual([]);
    const after = (await points('motorfix_storage_requests_total'))
      .filter((point) => point.attributes['operation'] === 'GetObject')
      .reduce((sum, point) => sum + Number(point.value), 0);
    expect(after).toBe(before);
  });

  it('records each call duration on the duration buckets', async () => {
    const [duration] = (
      await points('motorfix_storage_request_duration_seconds')
    ).filter((point) => point.attributes['operation'] === 'PutObject');
    expect(
      (duration?.value as Histogram | undefined)?.buckets.boundaries,
    ).toEqual([0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]);
  });
});
