import { diag, metrics, SpanStatusCode, trace } from '@opentelemetry/api';
import type { Job, Queue, Worker } from 'bullmq';

import { telemetryStarted } from '../setup/start';

const READ_INTERVAL_MS = 15_000;
const observed = new WeakSet<object>();

const meter = () => metrics.getMeter('motorfix');

// Counts each job's outcome and duration by queue and job name, and records
// a failure on the job's span. A failure that will be retried counts as
// `retried`; the final one counts as `failed` and ends the span in error.
// The worker's own listeners and processor write the error log lines.
export function observeWorker(worker: Worker): void {
  if (!telemetryStarted() || observed.has(worker)) return;
  observed.add(worker);
  const jobs = meter().createCounter('motorfix_jobs_total', {
    description: 'Jobs finished, by outcome',
  });
  const duration = meter().createHistogram('motorfix_job_duration_seconds', {
    advice: { explicitBucketBoundaries: [0.1, 0.5, 1, 5, 15, 60, 300] },
    description: 'Time a job attempt took',
    unit: 's',
  });
  const record = (job: Job, outcome: string) => {
    const labels = { job_name: job.name, queue: worker.name };
    jobs.add(1, { ...labels, outcome });
    if (job.processedOn) {
      duration.record(
        ((job.finishedOn ?? Date.now()) - job.processedOn) / 1_000,
        labels,
      );
    }
  };

  worker.on('completed', (job: Job) => record(job, 'completed'));
  worker.on('failed', (job: Job | undefined, error: Error) => {
    if (!job) return;
    const final =
      error.name === 'UnrecoverableError' ||
      job.attemptsMade >= (job.opts.attempts ?? 1);
    record(job, final ? 'failed' : 'retried');
    const span = trace.getActiveSpan();
    span?.recordException(error);
    if (final) span?.setStatus({ code: SpanStatusCode.ERROR });
  });
}

// Reads the queue's waiting and failed counts and the age of its oldest
// waiting job every 15 seconds, for three gauges, until the queue closes.
// Returns the stop function.
export function observeQueue(queue: Queue): () => void {
  if (!telemetryStarted()) return () => undefined;
  const labels = { queue: queue.name };
  let reading = { failed: 0, oldestSeconds: 0, waiting: 0 };
  let failing = false;

  const read = async () => {
    if (queue.closing) {
      stop();
      return;
    }
    try {
      reading = await readQueue(queue);
      failing = false;
    } catch (error) {
      if (!failing)
        diag.error(`queue ${queue.name} not read: ${(error as Error).message}`);
      failing = true;
    }
  };

  const gauges = [
    meter().createObservableGauge('motorfix_queue_waiting', {
      description: 'Jobs waiting in the queue',
    }),
    meter().createObservableGauge('motorfix_queue_oldest_waiting_seconds', {
      description: 'Age of the oldest waiting job',
      unit: 's',
    }),
    meter().createObservableGauge('motorfix_queue_failed_total', {
      description: 'Jobs kept as failed in the queue',
    }),
  ] as const;
  const callbacks = [
    () => reading.waiting,
    () => reading.oldestSeconds,
    () => reading.failed,
  ].map((value, i) => {
    const callback = (result: {
      observe(value: number, attributes: typeof labels): void;
    }) => result.observe(value(), labels);
    gauges[i].addCallback(callback);
    return callback;
  });

  const timer = setInterval(() => void read(), READ_INTERVAL_MS);
  timer.unref();
  const stop = () => {
    clearInterval(timer);
    callbacks.forEach((callback, i) => {
      gauges[i].removeCallback(callback);
    });
  };
  void read();
  return stop;
}

async function readQueue(queue: Queue) {
  const [counts, [oldest]] = await Promise.all([
    queue.getJobCounts('waiting', 'failed'),
    queue.getWaiting(0, 0),
  ]);
  return {
    failed: counts['failed'] ?? 0,
    oldestSeconds: oldest ? (Date.now() - oldest.timestamp) / 1_000 : 0,
    waiting: counts['waiting'] ?? 0,
  };
}
