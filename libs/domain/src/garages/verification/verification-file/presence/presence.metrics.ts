import { metrics } from '@opentelemetry/api';

type PresenceOutcome = 'created' | 'removed' | 'store_unavailable';

// One count per entry created or removed and per store call that failed.
// Looked up on every count: a counter kept from before the meter provider is
// registered stays a no-op. No account or file is ever a label.
export function countPresence(outcome: PresenceOutcome) {
  metrics
    .getMeter('motorfix')
    .createCounter('motorfix_verification_presence_total', {
      description: 'Verification file presence entries, by outcome',
    })
    .add(1, { outcome });
}
