import type { Logger } from '@nestjs/common';
import type { Job, Worker } from 'bullmq';

import { inJob } from './logging';

// One error line when a job has failed for good: its last attempt, or an
// UnrecoverableError. A failure that will be retried writes nothing here.
export function logFinalFailure(worker: Worker, logger: Logger): void {
  worker.on('failed', (job: Job | undefined, error: Error) => {
    if (!job) return;
    const final =
      error.name === 'UnrecoverableError' ||
      job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!final) return;
    inJob(job, () =>
      logger.error(`${worker.name} job ${job.name} failed: ${error.message}`),
    );
  });
}
