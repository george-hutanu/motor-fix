import { inMemory } from '@motor-fix/observability/testing';
import { metrics } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';

import { recordCache, recordWarmRead } from './cache.metrics';

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

// @traces 1235-FR-004
describe('counting the brand lookups', () => {
  it('counts the brands kind like any other', async () => {
    recordCache('brands', 'negative');

    expect((await counts())['brands negative']).toBe(1);
  });
});

// @traces 1169-FR-011
describe('counting the sign-in warm', () => {
  it('counts the home kinds and records each warm read’s time by kind only', async () => {
    recordCache('garage-home', 'warm');
    recordCache('driver-home', 'hit');
    recordWarmRead('driver-home', 0.02);

    const counted = await counts();
    expect(counted['garage-home warm']).toBe(1);
    expect(counted['driver-home hit']).toBe(1);
    const { resourceMetrics } = await metricReader.collect();
    const histogram = resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .find(
        (metric) =>
          metric.descriptor.name === 'motorfix_cache_warm_read_seconds',
      );
    expect(histogram?.descriptor.unit).toBe('s');
    expect(histogram?.dataPoints).toHaveLength(1);
    const [point] = histogram?.dataPoints ?? [];
    expect(point?.attributes).toEqual({ kind: 'driver-home' });
    const value = point?.value as { sum: number; count: number } | undefined;
    expect(value?.count).toBe(1);
    expect(value?.sum).toBeCloseTo(0.02);
  });
});
