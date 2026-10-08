import {
  AggregationTemporality,
  InstrumentType,
} from '@opentelemetry/sdk-metrics';

import { gaugeDelta } from './temporality';

describe('gaugeDelta', () => {
  it.each([InstrumentType.GAUGE, InstrumentType.OBSERVABLE_GAUGE])(
    'exports %s as delta',
    (type) => {
      expect(gaugeDelta(type)).toBe(AggregationTemporality.DELTA);
    },
  );

  it.each([
    InstrumentType.COUNTER,
    InstrumentType.HISTOGRAM,
    InstrumentType.UP_DOWN_COUNTER,
    InstrumentType.OBSERVABLE_COUNTER,
    InstrumentType.OBSERVABLE_UP_DOWN_COUNTER,
  ])('keeps %s cumulative', (type) => {
    expect(gaugeDelta(type)).toBe(AggregationTemporality.CUMULATIVE);
  });
});
