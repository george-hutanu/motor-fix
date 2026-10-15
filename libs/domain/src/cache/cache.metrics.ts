import { metrics } from '@opentelemetry/api';

export type CacheKind = 'profile' | 'home' | 'popular-brands';

// coalesced: a read served by another read's call (the stampedes avoided);
// negative: a remembered not-found or empty answer; fallback: Redis failed
// and the database answered; warm: an entry filled by the warm-up.
export type CacheOutcome =
  | 'hit'
  | 'miss'
  | 'stale'
  | 'coalesced'
  | 'negative'
  | 'fallback'
  | 'purge'
  | 'warm';

// Looked up on every count: a counter kept from before the meter provider is
// registered stays a no-op.
export function recordCache(kind: CacheKind, outcome: CacheOutcome) {
  metrics
    .getMeter('motorfix')
    .createCounter('motorfix_cache_total', {
      description: 'Cached public reads by kind and outcome, and purges',
    })
    .add(1, { kind, outcome });
}
