import { metrics } from '@opentelemetry/api';

// Looked up on every count: a counter kept from before the meter provider is
// registered stays a no-op.
const counter = (name: string, description: string) =>
  metrics.getMeter('motorfix').createCounter(name, { description });

export const SEARCH_CACHE_OUTCOMES = ['hit', 'miss', 'fallback'] as const;

export const searchCache = () =>
  counter(
    'motorfix_search_cache_total',
    'Garage search pages by cache outcome',
  );

// One count per first-page or cursor search read: from Redis, from
// PostgreSQL after a miss, or from PostgreSQL because Redis failed.
export function recordSearchCache(
  outcome: (typeof SEARCH_CACHE_OUTCOMES)[number],
) {
  searchCache().add(1, { outcome });
}

export const SEARCH_LOG_OUTCOMES = ['written', 'failed'] as const;

export const searchLog = () =>
  counter('motorfix_search_log_total', 'Search log rows, by outcome');

// One count per search log row written or lost.
export function recordSearchLog(outcome: (typeof SEARCH_LOG_OUTCOMES)[number]) {
  searchLog().add(1, { outcome });
}
