import { metrics } from '@opentelemetry/api';

// Looked up on every count: an instrument kept from before the meter provider
// is registered would stay a no-op for the life of the process.
const meter = () => metrics.getMeter('motorfix');

// An edit or delete of a repair the driver may not make yet, by its code.
export function recordEditRefusal(code: 'motorfix_repair' | 'not_implemented') {
  meter()
    .createCounter('motorfix_repair_edit_refusals_total', {
      description: 'Edits and deletes of a repair refused, by code',
    })
    .add(1, { code });
}
