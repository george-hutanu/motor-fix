import { metrics } from '@opentelemetry/api';

export type CacheKind =
  | 'profile'
  | 'home'
  | 'popular-brands'
  | 'brands'
  | 'driver-home'
  | 'garage-home';

// coalesced: a read served by another read's call (the stampedes avoided);
// negative: a remembered not-found or empty answer; fallback: Redis failed
// and the database answered; warm: an entry filled by the warm-up or a
// sign-in.
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
      description: 'Cached reads by kind and outcome, and purges',
    })
    .add(1, { kind, outcome });
}

// How long each read a warm fills took: the wait a hit on it saves.
export function recordWarmRead(kind: CacheKind, seconds: number) {
  metrics
    .getMeter('motorfix')
    .createHistogram('motorfix_cache_warm_read_seconds', {
      advice: {
        explicitBucketBoundaries: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
      },
      description: 'Time each warmed read took, by kind',
      unit: 's',
    })
    .record(seconds, { kind });
}
