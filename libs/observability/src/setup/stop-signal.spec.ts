// @traces 1000-FR-001 1000-FR-005
import { metrics, SpanKind, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';

import { startTelemetry, type Telemetry } from './start';
import { inMemory } from '../testing/in-memory';
import { addedListeners, type StopSignal } from '../testing/signals';

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
let telemetry: Telemetry | undefined;
const listeners = addedListeners(() => {
  telemetry = startTelemetry(
    'api',
    {
      APP_ENV: 'staging',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com/otlp',
    },
    exporters,
  );
});

// Whatever else the worker listens with stays registered: the handler's view
// of the listener count is the test's to set.
const unrelated = () => undefined;
const signals: StopSignal[] = ['SIGINT', 'SIGTERM'];
for (const signal of signals) process.on(signal, unrelated);

const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
const spanExport = jest.spyOn(memory.spanExporter, 'export');
const metricExport = jest.spyOn(metricExporter, 'export');
const logExport = jest.spyOn(memory.logExporter, 'export');

// The number of listeners the handler sees on the signal; every other event
// keeps its real count.
let listenerCount: jest.SpyInstance | undefined;
function listenersSeen(signal: StopSignal, count: number) {
  const real = process.listenerCount.bind(process);
  listenerCount = jest
    .spyOn(process, 'listenerCount')
    .mockImplementation((event) => (event === signal ? count : real(event)));
}

function recordPending() {
  trace
    .getTracer('spec')
    .startSpan('GET /api/v1/garages/:id', { kind: SpanKind.SERVER })
    .end();
  metrics.getMeter('spec').createCounter('spec_total').add(1);
  logs.getLogger('spec').emit({ body: 'last words' });
}

afterEach(() => {
  listenerCount?.mockRestore();
  jest.clearAllMocks();
  for (const signal of signals) {
    expect(process.listeners(signal)).toContain(unrelated);
  }
});

afterAll(() => {
  kill.mockRestore();
  for (const signal of signals) {
    process.removeListener(signal, listeners[signal]);
    process.removeListener(signal, unrelated);
  }
});

describe('the stop signal with telemetry on', () => {
  // @traces 1000-FR-002 1000-FR-003
  it.each(signals)(
    'leaves %s to the app when another listener handles it',
    (signal) => {
      recordPending();
      listenersSeen(signal, 2);

      listeners[signal](signal);

      expect(process.listeners(signal)).toContain(listeners[signal]);
      expect(spanExport).not.toHaveBeenCalled();
      expect(metricExport).not.toHaveBeenCalled();
      expect(logExport).not.toHaveBeenCalled();
      expect(kill).not.toHaveBeenCalled();
    },
  );

  // @traces 1000-FR-002 1000-FR-003 1000-FR-004
  it('exports the pending span, metric point and log record, then raises the signal again, when it is the last listener', async () => {
    recordPending();
    listenersSeen('SIGTERM', 1);

    listeners.SIGTERM('SIGTERM');
    await telemetry?.shutdown();

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

  // @traces 1000-FR-002 1000-FR-003 1000-FR-004
  it('raises SIGINT again once, when it is the last listener, after the shutdown has already run', async () => {
    listenersSeen('SIGINT', 1);

    listeners.SIGINT('SIGINT');
    await telemetry?.shutdown();

    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGINT');
    expect(process.listeners('SIGINT')).not.toContain(listeners.SIGINT);
  });
});
