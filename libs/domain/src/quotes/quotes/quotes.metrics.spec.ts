import { inMemory } from '@motor-fix/observability/testing';
import { metrics } from '@opentelemetry/api';
import {
  type HistogramMetricData,
  MeterProvider,
} from '@opentelemetry/sdk-metrics';

import {
  recordDeclineWindow,
  recordQuoteSend,
  recordRequestDecline,
} from './quotes.metrics';

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

const points = async (name: string) =>
  ((await metric(name))?.dataPoints ?? []).map((point) => ({
    ...point.attributes,
    value: point.value,
  }));

// @traces 345-FR-018
describe('counting declines and their windows', () => {
  it('adds one per decline by outcome and reason, with no identifiers', async () => {
    recordRequestDecline('declined', 'fully_booked');
    recordRequestDecline('declined', 'fully_booked');
    recordRequestDecline('already_answered', 'need_to_see_car');
    recordRequestDecline('request_not_open', 'job_not_done');
    recordRequestDecline('invalid', 'make_model_engine_not_done');

    expect(await points('motorfix_request_declines_total')).toEqual(
      expect.arrayContaining([
        { outcome: 'declined', reason: 'fully_booked', value: 2 },
        { outcome: 'already_answered', reason: 'need_to_see_car', value: 1 },
        { outcome: 'request_not_open', reason: 'job_not_done', value: 1 },
        {
          outcome: 'invalid',
          reason: 'make_model_engine_not_done',
          value: 1,
        },
      ]),
    );
  });

  it('adds one per window closed by outcome and whether the sweep ran it', async () => {
    recordDeclineWindow('sent', false);
    recordDeclineWindow('sent', true);
    recordDeclineWindow('muted', false);
    recordDeclineWindow('skipped_undone', false);
    recordDeclineWindow('skipped_closed', true);
    recordDeclineWindow('already_told', false);

    expect(await points('motorfix_decline_windows_closed_total')).toEqual(
      expect.arrayContaining([
        { outcome: 'sent', sweep: 'false', value: 1 },
        { outcome: 'sent', sweep: 'true', value: 1 },
        { outcome: 'muted', sweep: 'false', value: 1 },
        { outcome: 'skipped_undone', sweep: 'false', value: 1 },
        { outcome: 'skipped_closed', sweep: 'true', value: 1 },
        { outcome: 'already_told', sweep: 'false', value: 1 },
      ]),
    );
  });
});
