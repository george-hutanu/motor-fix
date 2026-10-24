import { metrics } from '@opentelemetry/api';

// Looked up on every count: a counter kept from before the meter provider is
// registered stays a no-op.
const similarGarages = () =>
  metrics.getMeter('motorfix').createCounter('motorfix_similar_garages_total', {
    description:
      'Similar garages answers for a garage no longer listed, by whether any was found',
  });

export function recordSimilarGarages(outcome: 'results' | 'none') {
  similarGarages().add(1, { outcome });
}
