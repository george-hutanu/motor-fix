import { metrics } from '@opentelemetry/api';

// Looked up on every count: an instrument kept from before the meter provider
// is registered would stay a no-op for the life of the process.
const meter = () => metrics.getMeter('motorfix');

export type RepairFromJobOutcome =
  | 'created'
  | 'cost_updated'
  | 'unchanged'
  | 'job_missing';

// A run of the handover's repair write, by how it ended.
export function recordRepairFromJob(outcome: RepairFromJobOutcome) {
  meter()
    .createCounter('motorfix_repairs_from_jobs_total', {
      description: 'Runs of the repair a handed-over job leaves, by outcome',
    })
    .add(1, { outcome });
}
