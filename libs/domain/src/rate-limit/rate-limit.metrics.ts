import { metrics } from '@opentelemetry/api';

// One count per call refused past a limit, by its method and route template
// (`unknown` when none): never an address, an account or an e-mail. Looked up
// on every count: a counter kept from before the meter provider is
// registered stays a no-op.
export function countRateLimitRefusal(route: string) {
  metrics
    .getMeter('motorfix')
    .createCounter('motorfix_rate_limit_refusals_total', {
      description: 'Calls refused past a rate limit, by route',
    })
    .add(1, { route });
}
