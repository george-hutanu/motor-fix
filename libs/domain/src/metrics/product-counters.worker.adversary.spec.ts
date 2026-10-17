import { startTelemetry } from '@motor-fix/observability';
import { counterTotal, inMemory } from '@motor-fix/observability/testing';
import type { DataPoint } from '@opentelemetry/sdk-metrics';

import {
  countEmail,
  countQuote,
  initProductCounters,
} from './product-counters';

const memory = inMemory();
const started = startTelemetry(
  'worker',
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
describe('the worker product counters started more than once', () => {
  it('adds no series and no value when started twice', async () => {
    initProductCounters('worker');
    const first = await series();

    initProductCounters('worker');
    const again = await series();

    expect(again.map(key).sort()).toEqual(first.map(key).sort());
    expect(again.filter((one) => one.value !== 0)).toEqual([]);
  });

  it('keeps counts made before a second start', async () => {
    initProductCounters('worker');
    countQuote();

    initProductCounters('worker');

    expect(
      await counterTotal(memory.metricReader, 'motorfix_quotes_total', {}),
    ).toBe(1);
  });

  it('adds no series when an e-mail of a registered template is counted', async () => {
    initProductCounters('worker');
    const before = await series();
    const template = before
      .filter((one) => one.name === 'motorfix_emails_sent_total')
      .map((one) => String(one.labels['template']))[0];

    countEmail(template ?? '');

    expect((await series()).length).toBe(before.length);
    expect(
      await counterTotal(memory.metricReader, 'motorfix_emails_sent_total', {
        template: template ?? '',
      }),
    ).toBe(1);
  });

  it('has no duplicate series and none with an empty label value', async () => {
    initProductCounters('worker');

    const all = await series();
    const keys = all.map(key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(all.filter((one) => Object.values(one.labels).includes(''))).toEqual(
      [],
    );
  });
});
