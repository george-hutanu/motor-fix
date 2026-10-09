import { metrics } from '@opentelemetry/api';

type ProfileCacheOutcome = 'hit' | 'miss' | 'drop';

let profileCache:
  | ReturnType<ReturnType<typeof metrics.getMeter>['createCounter']>
  | undefined;

// One count per public profile read served from Redis or not, and per drop.
export function recordProfileCache(outcome: ProfileCacheOutcome) {
  profileCache ??= metrics
    .getMeter('motorfix')
    .createCounter('motorfix_garage_profile_cache_total', {
      description: 'Public garage profile reads by cache outcome, and drops',
    });
  profileCache.add(1, { outcome });
}
