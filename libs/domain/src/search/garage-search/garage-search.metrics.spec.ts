import { inMemory } from '@motor-fix/observability/testing';
import { metrics } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';

import { recordSearchCache, recordSearchLog } from './garage-search.metrics';

const { metricReader } = inMemory();
metrics.setGlobalMeterProvider(new MeterProvider({ readers: [metricReader] }));

async function counts(name: string) {
  const { resourceMetrics } = await metricReader.collect();
  const found = resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find((metric) => metric.descriptor.name === name);
  return Object.fromEntries(
    (found?.dataPoints ?? []).map((point) => [
      point.attributes['outcome'],
      point.value,
    ]),
  );
}

// @traces 267-brand-results-FR-023
describe('counting the search cache and the search log', () => {
  it('adds one per cache read, by outcome', async () => {
    recordSearchCache('hit');
    recordSearchCache('hit');
    recordSearchCache('miss');
    recordSearchCache('fallback');

    expect(await counts('motorfix_search_cache_total')).toEqual({
      fallback: 1,
      hit: 2,
      miss: 1,
    });
  });

  it('adds one per log write, by outcome', async () => {
    recordSearchLog('written');
    recordSearchLog('written');
    recordSearchLog('failed');

    expect(await counts('motorfix_search_log_total')).toEqual({
      failed: 1,
      written: 2,
    });
  });
});
