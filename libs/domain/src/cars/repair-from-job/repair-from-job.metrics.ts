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

// An edit or delete of a repair the driver may not make yet, by its code.
export function recordEditRefusal(code: 'motorfix_repair' | 'not_implemented') {
  meter()
    .createCounter('motorfix_repair_edit_refusals_total', {
      description: 'Edits and deletes of a repair refused, by code',
    })
    .add(1, { code });
}
