import { metrics } from '@opentelemetry/api';

type LookupOutcome = 'found' | 'empty' | 'unavailable' | 'throttled';

const meter = () => metrics.getMeter('motorfix');

let lookups: ReturnType<ReturnType<typeof meter>['createCounter']> | undefined;
let duration:
  | ReturnType<ReturnType<typeof meter>['createHistogram']>
  | undefined;

// One count per look-up by provider and outcome, and the provider's time.
export function recordLookup(
  provider: string,
  outcome: LookupOutcome,
  seconds?: number,
) {
  lookups ??= meter().createCounter('motorfix_places_lookups_total', {
    description: 'Address look-ups, by provider and outcome',
  });
  duration ??= meter().createHistogram(
    'motorfix_places_provider_duration_seconds',
    {
      advice: { explicitBucketBoundaries: [0.1, 0.25, 0.5, 1, 2, 3] },
      description: 'Time the address provider took to answer',
      unit: 's',
    },
  );
  lookups.add(1, { outcome, provider });
  if (seconds !== undefined) duration.record(seconds, { provider });
}
