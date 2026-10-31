import { metrics } from '@opentelemetry/api';

// One count per free-slot answer: some starts, or none inside the horizon.
// Looked up on every count: a counter kept from before the meter provider is
// registered stays a no-op.
export function recordFreeSlots(outcome: 'slots' | 'none_in_horizon') {
  metrics
    .getMeter('motorfix')
    .createCounter('motorfix_free_slots_answers_total', {
      description: 'Free-slot answers, by outcome',
    })
    .add(1, { outcome });
}
