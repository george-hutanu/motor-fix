import { inMemory } from '@motor-fix/observability/testing';
import { metrics } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';

import { recordRows, recordView } from './profile-views.metrics';

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

// @traces 143-FR-014
describe('counting profile views', () => {
  it('adds one per beacon, by what became of it', async () => {
    recordView('accepted');
    recordView('accepted');
    recordView('bot');
    recordView('lost');

    expect(await counts('motorfix_profile_views_total')).toEqual({
      accepted: 2,
      bot: 1,
      lost: 1,
    });
  });

  it('adds the rows the night wrote, and nothing for a night with no gap', async () => {
    recordRows('written', 3);
    recordRows('gap', 0);

    expect(await counts('motorfix_profile_view_rows_total')).toEqual({
      written: 3,
    });
  });

  it('adds the days a night missed', async () => {
    recordRows('gap', 2);

    expect(await counts('motorfix_profile_view_rows_total')).toEqual({
      gap: 2,
      written: 3,
    });
  });
});
