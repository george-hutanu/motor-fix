import { isFinalFailure } from '@motor-fix/observability';
import type { Logger } from '@nestjs/common';
import type { Job, Worker } from 'bullmq';

import { systemLog } from './admin/system-log/system-log';
import { inJob } from './logging';

// The system status log's entry for a job that failed for good: its queue,
// name, attempts and the error's own code or class, never its message.
export function writeJobFailed(
  queue: string,
  job: Pick<Job, 'attemptsMade' | 'name'>,
  error: Error,
): void {
  const code = (error as { code?: unknown }).code;
  void systemLog.write('job_failed', 'worker', {
    attempts: job.attemptsMade,
    error_code: typeof code === 'string' ? code : error.constructor.name,
    job: job.name,
    queue,
  });
}

// One error line when a job has failed for good: its last attempt, or an
// UnrecoverableError. A failure that will be retried writes nothing here.
export function logFinalFailure(worker: Worker, logger: Logger): void {
  worker.on('failed', (job: Job | undefined, error: Error) => {
    if (!job) return;
    if (!isFinalFailure(job, error)) return;
    inJob(job, () =>
      logger.error(`${worker.name} job ${job.name} failed: ${error.message}`),
    );
    writeJobFailed(worker.name, job, error);
  });
}
