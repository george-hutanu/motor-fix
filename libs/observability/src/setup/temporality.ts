import type {
  AggregationTemporality,
  InstrumentType,
} from '@opentelemetry/sdk-metrics';

// Gauges are exported as delta: a gauge stream is only what its callbacks
// observed at this collection, so a figure that stops being observed (a
// store that went down, a reading stopped) leaves the export instead of
// repeating its last value. OTLP gauges carry no temporality, so nothing
// changes on the wire; every other instrument stays cumulative.
// The SDK is required on the first call, as startTelemetry loads it only
// when telemetry is on.
export function gaugeDelta(type: InstrumentType): AggregationTemporality {
  const sdk =
    require('@opentelemetry/sdk-metrics') as typeof import('@opentelemetry/sdk-metrics');
  return type === sdk.InstrumentType.GAUGE ||
    type === sdk.InstrumentType.OBSERVABLE_GAUGE
    ? sdk.AggregationTemporality.DELTA
    : sdk.AggregationTemporality.CUMULATIVE;
}
