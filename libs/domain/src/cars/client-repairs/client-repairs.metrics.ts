import { metrics } from '@opentelemetry/api';

// Looked up on every count: an instrument kept from before the meter provider
// is registered would stay a no-op for the life of the process.
const meter = () => metrics.getMeter('motorfix');

export type CorrectionOutcome =
  | 'corrected'
  | 'unchanged'
  | 'stale'
  | 'not_found';

// A correction that reached the use case, by who made it and how it ended; a
// 400 or a 403 is read from the status codes.
export function recordCorrection(
  by: 'owner' | 'admin',
  outcome: CorrectionOutcome,
) {
  meter()
    .createCounter('motorfix_repair_corrections_total', {
      description: 'Corrections of a logged repair, by writer and outcome',
    })
    .add(1, { by, outcome });
}
