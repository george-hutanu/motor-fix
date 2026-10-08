import {
  AggregationTemporality,
  InstrumentType,
} from '@opentelemetry/sdk-metrics';

// Gauges are exported as delta: a gauge stream is only what its callbacks
// observed at this collection, so a figure that stops being observed (a
// store that went down, a reading stopped) leaves the export instead of
// repeating its last value. OTLP gauges carry no temporality, so nothing
// changes on the wire; every other instrument stays cumulative.
export function gaugeDelta(type: InstrumentType): AggregationTemporality {
  return type === InstrumentType.GAUGE ||
    type === InstrumentType.OBSERVABLE_GAUGE
    ? AggregationTemporality.DELTA
    : AggregationTemporality.CUMULATIVE;
}
