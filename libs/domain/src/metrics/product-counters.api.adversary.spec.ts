import { startTelemetry } from '@motor-fix/observability';
import { counterTotal, inMemory } from '@motor-fix/observability/testing';
import type { DataPoint } from '@opentelemetry/sdk-metrics';

import {
  countQuote,
  countSignIn,
  initProductCounters,
} from './product-counters';

const memory = inMemory();
const started = startTelemetry(
  'api',
  { APP_ENV: 'test', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);
afterAll(() => started?.shutdown());

async function series() {
  const { resourceMetrics } = await memory.metricReader.collect();
  return resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .filter((metric) => metric.descriptor.name.startsWith('motorfix_'))
    .flatMap((metric) =>
      (metric.dataPoints as DataPoint<number>[]).map((point) => ({
        labels: point.attributes,
        name: metric.descriptor.name,
        value: point.value,
      })),
    );
}

const key = (one: { name: string; labels: object }) =>
  `${one.name}${JSON.stringify(Object.entries(one.labels).sort())}`;

// @traces 1345-FR-012
describe('the API product counters started more than once', () => {
  it('adds no series and no value when started twice', async () => {
    initProductCounters('api');
    const first = await series();

    initProductCounters('api');
    initProductCounters('api');
    const again = await series();

    expect(again.map(key).sort()).toEqual(first.map(key).sort());
    expect(again.filter((one) => one.value !== 0)).toEqual([]);
  });

  it('keeps a count made before a second start', async () => {
    initProductCounters('api');
    countSignIn('google');
    countSignIn('google');

    initProductCounters('api');

    expect(
      await counterTotal(memory.metricReader, 'motorfix_sign_ins_total', {
        method: 'google',
      }),
    ).toBe(2);
  });

  it('has no series without a name-bearing label value', async () => {
    initProductCounters('api');

    const empty = (await series()).filter((one) =>
      Object.values(one.labels).some(
        (value) => value === '' || value === undefined || value === 'undefined',
      ),
    );
    expect(empty).toEqual([]);
  });

  it('has no duplicate series within one counter', async () => {
    initProductCounters('api');

    const keys = (await series()).map(key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('stays under 100 series and under 50 per counter', async () => {
    initProductCounters('api');

    const all = await series();
    expect(all.length).toBeLessThan(100);
    const perCounter = new Map<string, number>();
    for (const one of all)
      perCounter.set(one.name, (perCounter.get(one.name) ?? 0) + 1);
    expect(Math.max(...perCounter.values())).toBeLessThan(50);
  });

  it('counts a worker-only counter from 0 to 1 when the API process records it', async () => {
    initProductCounters('api');

    countQuote();

    expect(
      await counterTotal(memory.metricReader, 'motorfix_quotes_total', {}),
    ).toBe(1);
  });
});
