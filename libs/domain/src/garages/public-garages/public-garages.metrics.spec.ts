import { inMemory } from '@motor-fix/observability/testing';
import { metrics } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';

import { recordProfileCache } from './public-garages.metrics';

const { metricReader } = inMemory();
metrics.setGlobalMeterProvider(new MeterProvider({ readers: [metricReader] }));

async function counts() {
  const { resourceMetrics } = await metricReader.collect();
  const found = resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find(
      (metric) =>
        metric.descriptor.name === 'motorfix_garage_profile_cache_total',
    );
  return Object.fromEntries(
    (found?.dataPoints ?? []).map((point) => [
      point.attributes['outcome'],
      point.value,
    ]),
  );
}

// @traces 307-FR-007
describe('counting the garage profile cache', () => {
  it('adds one per hit, miss and drop, by outcome', async () => {
    recordProfileCache('hit');
    recordProfileCache('hit');
    recordProfileCache('miss');
    recordProfileCache('drop');

    expect(await counts()).toEqual({ drop: 1, hit: 2, miss: 1 });
  });
});
