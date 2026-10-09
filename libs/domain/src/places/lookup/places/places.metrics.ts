import { metrics } from '@opentelemetry/api';

type LookupOutcome = 'found' | 'empty' | 'unavailable' | 'throttled';

// Looked up on every count: an instrument kept from before the meter provider
// is registered would stay a no-op for the life of the process.
const meter = () => metrics.getMeter('motorfix');

// One count per look-up by provider and outcome, and the provider's time.
export function recordLookup(
  provider: string,
  outcome: LookupOutcome,
  seconds?: number,
) {
  meter()
    .createCounter('motorfix_places_lookups_total', {
      description: 'Address look-ups, by provider and outcome',
    })
    .add(1, { outcome, provider });
  if (seconds === undefined) return;
  meter()
    .createHistogram('motorfix_places_provider_duration_seconds', {
      advice: { explicitBucketBoundaries: [0.1, 0.25, 0.5, 1, 2, 3] },
      description: 'Time the address provider took to answer',
      unit: 's',
    })
    .record(seconds, { provider });
}
