import { metrics } from '@opentelemetry/api';

type ProfileCacheOutcome = 'hit' | 'miss' | 'drop';

// One count per public profile read served from Redis or not, and per drop.
// The counter is looked up on every count: one kept from before the meter
// provider is registered stays a no-op.
export function recordProfileCache(outcome: ProfileCacheOutcome) {
  metrics
    .getMeter('motorfix')
    .createCounter('motorfix_garage_profile_cache_total', {
      description: 'Public garage profile reads by cache outcome, and drops',
    })
    .add(1, { outcome });
}
