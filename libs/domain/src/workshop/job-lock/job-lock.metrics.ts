import { metrics } from '@opentelemetry/api';

// locked: a take or a change refused because another person holds the job;
// stale: a change refused for a stale basedOnUpdatedAt; expired: a mirror the
// sweep cleared after its key ran out; unavailable: Redis did not answer.
export type JobLockAction =
  | 'take'
  | 'refresh'
  | 'release'
  | 'force'
  | 'locked'
  | 'stale'
  | 'expired'
  | 'unavailable';

// Looked up on every count, never cached: an instrument kept from before the
// meter provider is registered would stay a no-op for the life of the process.
export function countJobLock(action: JobLockAction, by = 1) {
  metrics
    .getMeter('motorfix')
    .createCounter('motorfix_job_lock_outcomes_total', {
      description: "What became of a job's edit lock, by action",
    })
    .add(by, { action });
}
