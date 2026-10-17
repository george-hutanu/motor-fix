import { metrics } from '@opentelemetry/api';

// Looked up on every count: a counter kept from before the meter provider is
// registered stays a no-op.
const counter = (name: string, description: string) =>
  metrics.getMeter('motorfix').createCounter(name, { description });

// One count per first-page or cursor search read: from Redis, from
// PostgreSQL after a miss, or from PostgreSQL because Redis failed.
export function recordSearchCache(outcome: 'hit' | 'miss' | 'fallback') {
  counter(
    'motorfix_search_cache_total',
    'Garage search pages by cache outcome',
  ).add(1, { outcome });
}

// One count per search log row written or lost.
export function recordSearchLog(outcome: 'written' | 'failed') {
  counter('motorfix_search_log_total', 'Search log rows, by outcome').add(1, {
    outcome,
  });
}

// One count per pins answer, cached or not, by whether it found a garage and
// by whether it read the place's area or the map's box.
export function recordSearchPins(
  outcome: 'results' | 'none',
  mode: 'area' | 'bbox',
) {
  counter(
    'motorfix_search_pins_total',
    'Map pin answers, by outcome and mode',
  ).add(1, { mode, outcome });
}
