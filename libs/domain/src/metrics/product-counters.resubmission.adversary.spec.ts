import { startTelemetry } from '@motor-fix/observability';
import { inMemory } from '@motor-fix/observability/testing';
import type { DataPoint } from '@opentelemetry/sdk-metrics';

import { countResubmission } from './product-counters';

const memory = inMemory();
const started = startTelemetry(
  'api',
  { APP_ENV: 'test', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);
afterAll(() => started?.shutdown());

async function resubmissions() {
  const { resourceMetrics } = await memory.metricReader.collect();
  return resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .filter(
      (metric) =>
        metric.descriptor.name === 'motorfix_verification_resubmissions_total',
    )
    .flatMap((metric) =>
      (metric.dataPoints as DataPoint<number>[]).map((point) => ({
        after: point.attributes['after'],
        value: point.value,
      })),
    );
}

// @traces 1273-FR-008
describe('the resubmissions counter', () => {
  it('keeps the two sources apart, each counted once per call', async () => {
    countResubmission('rejected');
    countResubmission('rejected');
    countResubmission('more_requested');

    const series = await resubmissions();

    expect(
      series.sort((a, b) => String(a.after).localeCompare(String(b.after))),
    ).toEqual([
      { after: 'more_requested', value: 1 },
      { after: 'rejected', value: 2 },
    ]);
  });
});
