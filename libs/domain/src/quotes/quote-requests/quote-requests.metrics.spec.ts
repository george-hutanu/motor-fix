import { inMemory } from '@motor-fix/observability/testing';
import { metrics } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';

import { recordSend } from './quote-requests.metrics';

const { metricReader } = inMemory();
metrics.setGlobalMeterProvider(new MeterProvider({ readers: [metricReader] }));

async function points() {
  const { resourceMetrics } = await metricReader.collect();
  const found = resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find((m) => m.descriptor.name === 'motorfix_quote_requests_sent_total');
  return (found?.dataPoints ?? []).map((point) => ({
    ...point.attributes,
    value: point.value,
  }));
}

// @traces 221-FR-018
describe('counting quote requests sent', () => {
  it('adds one per send by outcome, with the recipients of a sent one', async () => {
    recordSend('sent', 3);
    recordSend('sent', 3);
    recordSend('limit');
    recordSend('cannot_receive');
    recordSend('invalid');

    expect(await points()).toEqual(
      expect.arrayContaining([
        { outcome: 'sent', recipients: 3, value: 2 },
        { outcome: 'limit', value: 1 },
        { outcome: 'cannot_receive', value: 1 },
        { outcome: 'invalid', value: 1 },
      ]),
    );
  });
});
