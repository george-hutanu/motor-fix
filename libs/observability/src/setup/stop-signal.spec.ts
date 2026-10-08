import { metrics, SpanKind, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';

import { startTelemetry } from './start';
import { inMemory } from '../testing/in-memory';
import { addedListeners, aloneOn, type StopSignal } from '../testing/signals';

const memory = inMemory();
const metricExporter = new InMemoryMetricExporter(
  AggregationTemporality.CUMULATIVE,
);
const exporters = {
  ...memory,
  metricReader: new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 60_000,
  }),
};
const listeners = addedListeners(() =>
  startTelemetry(
    'api',
    {
      APP_ENV: 'staging',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com/otlp',
    },
    exporters,
  ),
);

const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
const spanExport = jest.spyOn(memory.spanExporter, 'export');
const metricExport = jest.spyOn(metricExporter, 'export');
const logExport = jest.spyOn(memory.logExporter, 'export');

function recordPending() {
  trace
    .getTracer('spec')
    .startSpan('GET /api/v1/garages/:id', { kind: SpanKind.SERVER })
    .end();
  metrics.getMeter('spec').createCounter('spec_total').add(1);
  logs.getLogger('spec').emit({ body: 'last words' });
}

// Waits for `until`, by the clock rather than a count of turns: on a loaded CI
// runner the exports outlast 200 turns, and the signal they then raise lands
// in the next test. With no `until`, lets 200 turns pass.
async function settle(until?: () => boolean, timeoutMs = 10_000) {
  if (!until) {
    for (let tick = 0; tick < 200; tick++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    return;
  }
  const deadline = Date.now() + timeoutMs;
  while (!until() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

afterEach(() => jest.clearAllMocks());

afterAll(() => {
  kill.mockRestore();
  for (const signal of ['SIGINT', 'SIGTERM'] as StopSignal[]) {
    process.removeListener(signal, listeners[signal]);
  }
});

describe('the stop signal with telemetry on', () => {
  it.each(['SIGTERM', 'SIGINT'] as StopSignal[])(
    'leaves %s to the app when another listener handles it',
    async (signal) => {
      recordPending();
      const app = () => undefined;
      process.on(signal, app);

      listeners[signal](signal);
      await settle();

      process.removeListener(signal, app);
      expect(spanExport).not.toHaveBeenCalled();
      expect(metricExport).not.toHaveBeenCalled();
      expect(logExport).not.toHaveBeenCalled();
      expect(kill).not.toHaveBeenCalled();
    },
  );

  it('exports the pending span, metric point and log record, then raises the signal again, when it is the last listener', async () => {
    const restore = aloneOn('SIGTERM', listeners.SIGTERM);

    listeners.SIGTERM('SIGTERM');
    await settle(() => kill.mock.calls.length > 0);
    restore();

    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
    const raised = kill.mock.invocationCallOrder[0] ?? 0;
    for (const exported of [spanExport, metricExport, logExport]) {
      expect(exported).toHaveBeenCalled();
      expect(exported.mock.invocationCallOrder[0]).toBeLessThan(raised);
    }
    expect(
      spanExport.mock.calls.flatMap(([spans]) => spans.map((s) => s.name)),
    ).toContain('GET /api/v1/garages/:id');
    expect(
      logExport.mock.calls.flatMap(([records]) =>
        records.map((record) => record.body),
      ),
    ).toContain('last words');
    expect(process.listeners('SIGTERM')).not.toContain(listeners.SIGTERM);
  });

  it('raises SIGINT again once, when it is the last listener', async () => {
    const restore = aloneOn('SIGINT', listeners.SIGINT);

    listeners.SIGINT('SIGINT');
    await settle(() => kill.mock.calls.length > 0);
    restore();

    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGINT');
    expect(process.listeners('SIGINT')).not.toContain(listeners.SIGINT);
  });
});
