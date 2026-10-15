import { inMemory } from '@motor-fix/observability/testing';
import { metrics } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';

import { recordCache } from './cache.metrics';

const { metricReader } = inMemory();
metrics.setGlobalMeterProvider(new MeterProvider({ readers: [metricReader] }));

async function counts() {
  const { resourceMetrics } = await metricReader.collect();
  const found = resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find((metric) => metric.descriptor.name === 'motorfix_cache_total');
  return Object.fromEntries(
    (found?.dataPoints ?? []).map((point) => [
      `${point.attributes['kind']} ${point.attributes['outcome']}`,
      point.value,
    ]),
  );
}

// @traces 1182-FR-014
describe('counting the cache', () => {
  it('adds one per outcome, by read kind', async () => {
    recordCache('profile', 'hit');
    recordCache('profile', 'hit');
    recordCache('profile', 'coalesced');
    recordCache('home', 'stale');
    recordCache('popular-brands', 'negative');
    recordCache('home', 'warm');

    expect(await counts()).toEqual({
      'home stale': 1,
      'home warm': 1,
      'popular-brands negative': 1,
      'profile coalesced': 1,
      'profile hit': 2,
    });
  });
});
