import { EventEmitter } from 'node:events';

import { diag, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { DataPoint } from '@opentelemetry/sdk-metrics';
import type { Queue, Worker } from 'bullmq';

import { observeQueue, observeWorker } from './observe';
import { startTelemetry } from '../setup/start';
import { inMemory } from '../testing';

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

interface FakeJob {
  id: string;
  name: string;
  attemptsMade: number;
  opts: { attempts?: number };
  processedOn: number;
  finishedOn?: number;
}

function fakeWorker(name = 'notifications') {
  return Object.assign(new EventEmitter(), { name }) as unknown as Worker &
    EventEmitter;
}

function job(overrides: Partial<FakeJob> = {}): FakeJob {
  return {
    attemptsMade: 1,
    finishedOn: 1_250,
    id: '42',
    name: 'send-email',
    opts: { attempts: 1 },
    processedOn: 1_000,
    ...overrides,
  };
}

/** Emits the event inside a process span, as bullmq does. */
function emitInSpan(worker: EventEmitter, event: string, ...args: unknown[]) {
  trace
    .getTracer('spec')
    .startActiveSpan(
      'process notifications',
      { kind: SpanKind.CONSUMER },
      (span) => {
        worker.emit(event, ...args);
        span.end();
      },
    );
}

async function points(name: string) {
  const { resourceMetrics } = await memory.metricReader.collect();
  return resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .filter((metric) => metric.descriptor.name === name)
    .flatMap((metric) => metric.dataPoints as DataPoint<unknown>[]);
}

describe('observeWorker', () => {
  it('counts a completed job and records its duration in seconds by queue and job name', async () => {
    const worker = fakeWorker();
    observeWorker(worker);

    emitInSpan(worker, 'completed', job({ name: 'completed-case' }));

    const jobs = await points('motorfix_jobs_total');
    expect(jobs).toContainEqual(
      expect.objectContaining({
        attributes: {
          job_name: 'completed-case',
          outcome: 'completed',
          queue: 'notifications',
        },
        value: 1,
      }),
    );
    const durations = await points('motorfix_job_duration_seconds');
    const duration = durations.find(
      (point) => point.attributes['job_name'] === 'completed-case',
    );
    expect(duration?.attributes).toEqual({
      job_name: 'completed-case',
      queue: 'notifications',
    });
    expect(duration?.value).toMatchObject({ count: 1, sum: 0.25 });
  });

  it('ends the job span of a final failure in error, with the exception', async () => {
    const worker = fakeWorker();
    observeWorker(worker);
    const failed = job({
      attemptsMade: 3,
      name: 'final-case',
      opts: { attempts: 3 },
    });
    const error = new Error('SMTP refused ana@example.com');

    emitInSpan(worker, 'failed', failed, error);
    await started?.flush();

    const [span] = memory.spanExporter.getFinishedSpans();
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(span?.events.map((event) => event.name)).toContain('exception');
    expect(await points('motorfix_jobs_total')).toContainEqual(
      expect.objectContaining({
        attributes: {
          job_name: 'final-case',
          outcome: 'failed',
          queue: 'notifications',
        },
        value: 1,
      }),
    );
  });

  it('counts a failure that will be retried as retried and records it on the attempt without an error status', async () => {
    const worker = fakeWorker();
    observeWorker(worker);

    emitInSpan(
      worker,
      'failed',
      job({ attemptsMade: 1, name: 'retry-case', opts: { attempts: 3 } }),
      new Error('timeout'),
    );
    await started?.flush();

    const [span] = memory.spanExporter.getFinishedSpans();
    expect(span?.events.map((event) => event.name)).toContain('exception');
    expect(span?.status.code).not.toBe(SpanStatusCode.ERROR);
    expect(await points('motorfix_jobs_total')).toContainEqual(
      expect.objectContaining({
        attributes: {
          job_name: 'retry-case',
          outcome: 'retried',
          queue: 'notifications',
        },
        value: 1,
      }),
    );
  });

  it('treats an unrecoverable error as final whatever the attempts left', async () => {
    const worker = fakeWorker();
    observeWorker(worker);
    const error = Object.assign(new Error('bad input'), {
      name: 'UnrecoverableError',
    });

    emitInSpan(
      worker,
      'failed',
      job({ name: 'unrecoverable-case', opts: { attempts: 5 } }),
      error,
    );
    await started?.flush();

    const [span] = memory.spanExporter.getFinishedSpans();
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
  });

  it('subscribes once however often it is called for the same worker', async () => {
    const worker = fakeWorker();
    observeWorker(worker);
    observeWorker(worker);

    emitInSpan(worker, 'completed', job({ name: 'once-case' }));

    expect(await points('motorfix_jobs_total')).toContainEqual(
      expect.objectContaining({
        attributes: {
          job_name: 'once-case',
          outcome: 'completed',
          queue: 'notifications',
        },
        value: 1,
      }),
    );
  });
});

describe('observeQueue', () => {
  function fakeQueue(
    name: string,
    read: Partial<Record<'counts' | 'waiting', unknown>> = {},
  ) {
    return {
      getJobCounts: jest.fn(
        async () => read.counts ?? { failed: 2, waiting: 5 },
      ),
      getWaiting: jest.fn(
        async () => read.waiting ?? [{ timestamp: Date.now() - 30_000 }],
      ),
      name,
    } as unknown as Queue & {
      getJobCounts: jest.Mock;
      getWaiting: jest.Mock;
    };
  }

  afterEach(() => jest.useRealTimers());

  it('reports waiting, oldest waiting age and failed counts by queue, read every 15 seconds', async () => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'performance', 'hrtime'],
    });
    const queue = fakeQueue('reminders');
    const stop = observeQueue(queue);
    await jest.advanceTimersByTimeAsync(0);

    expect(await points('motorfix_queue_waiting')).toContainEqual(
      expect.objectContaining({ attributes: { queue: 'reminders' }, value: 5 }),
    );
    expect(await points('motorfix_queue_failed_total')).toContainEqual(
      expect.objectContaining({ attributes: { queue: 'reminders' }, value: 2 }),
    );
    expect(
      await points('motorfix_queue_oldest_waiting_seconds'),
    ).toContainEqual(
      expect.objectContaining({
        attributes: { queue: 'reminders' },
        value: 30,
      }),
    );
    expect(queue.getWaiting).toHaveBeenCalledWith(0, 0);

    await jest.advanceTimersByTimeAsync(15_000);
    expect(queue.getJobCounts).toHaveBeenCalledTimes(2);

    stop();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(queue.getJobCounts).toHaveBeenCalledTimes(2);
  });

  it('stops reading once the queue closes', async () => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'performance', 'hrtime'],
    });
    const queue = fakeQueue('closing');
    observeQueue(queue);
    await jest.advanceTimersByTimeAsync(0);
    Object.assign(queue, { closing: Promise.resolve() });

    await jest.advanceTimersByTimeAsync(60_000);

    expect(queue.getJobCounts).toHaveBeenCalledTimes(1);
  });

  it('reports an oldest age of 0 for an empty queue', async () => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'performance', 'hrtime'],
    });
    const stop = observeQueue(
      fakeQueue('insights', { counts: { failed: 0, waiting: 0 }, waiting: [] }),
    );
    await jest.advanceTimersByTimeAsync(0);

    expect(
      await points('motorfix_queue_oldest_waiting_seconds'),
    ).toContainEqual(
      expect.objectContaining({ attributes: { queue: 'insights' }, value: 0 }),
    );
    stop();
  });

  it('swallows a read error and reports it once through diag', async () => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'performance', 'hrtime'],
    });
    const error = jest.spyOn(diag, 'error').mockImplementation(() => {});
    const queue = fakeQueue('outbox');
    queue.getJobCounts.mockRejectedValue(new Error('redis down'));

    const stop = observeQueue(queue);
    await jest.advanceTimersByTimeAsync(45_000);

    expect(error).toHaveBeenCalledTimes(1);
    stop();
    error.mockRestore();
  });
});
