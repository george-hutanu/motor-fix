import { inMemory } from '@motor-fix/observability/testing';
import { metrics } from '@opentelemetry/api';
import {
  type HistogramMetricData,
  MeterProvider,
} from '@opentelemetry/sdk-metrics';

import { recordQuoteSend } from './quotes.metrics';

const { metricReader } = inMemory();
// A count before telemetry starts is lost, and must not keep later ones out.
recordQuoteSend('refused');
metrics.setGlobalMeterProvider(new MeterProvider({ readers: [metricReader] }));

async function metric(name: string) {
  const { resourceMetrics } = await metricReader.collect();
  return resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find((m) => m.descriptor.name === name);
}

// @traces 344-FR-018
describe('counting quotes sent', () => {
  it('adds one per send by outcome and times only the sent ones, with no identifiers', async () => {
    recordQuoteSend('sent', 42);
    recordQuoteSend('sent', 3);
    recordQuoteSend('refused');
    recordQuoteSend('already_answered');
    recordQuoteSend('request_not_open');

    const sent = await metric('motorfix_quotes_sent_total');
    expect(
      (sent?.dataPoints ?? []).map((point) => ({
        ...point.attributes,
        value: point.value,
      })),
    ).toEqual(
      expect.arrayContaining([
        { outcome: 'sent', value: 2 },
        { outcome: 'refused', value: 1 },
        { outcome: 'already_answered', value: 1 },
        { outcome: 'request_not_open', value: 1 },
      ]),
    );

    const minutes = (await metric(
      'motorfix_quote_response_minutes',
    )) as HistogramMetricData;
    expect(minutes.dataPoints).toHaveLength(1);
    const [point] = minutes.dataPoints;
    expect(point.attributes).toEqual({});
    expect(point.value.count).toBe(2);
    expect(point.value.sum).toBe(45);
    expect(point.value.buckets.boundaries).toEqual([
      5, 15, 30, 60, 180, 360, 720, 1440, 2880, 10080,
    ]);
  });
});
