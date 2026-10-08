import { telemetry } from '@motor-fix/contracts/env';
import {
  context,
  type DiagLogger,
  DiagLogLevel,
  diag,
  metrics,
  propagation,
  trace,
} from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import type { Instrumentation } from '@opentelemetry/instrumentation';
import type { LogRecordExporter } from '@opentelemetry/sdk-logs';
import type { MetricReader } from '@opentelemetry/sdk-metrics';
import type { SpanExporter } from '@opentelemetry/sdk-trace-node';

import { observeCpu } from './cpu';
import { instrumentations } from './instrumentations';
import { sampler } from './sampler';
import { scrub } from '../scrub/scrub';

export type Service = 'api' | 'worker' | 'mcp';

export interface Exporters {
  spanExporter?: SpanExporter;
  metricReader?: MetricReader;
  logExporter?: LogRecordExporter;
}

export interface Telemetry {
  endpoint: URL;
  env: string;
  traceSampleRatio: number;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

const EXPORT_TIMEOUT_MS = 5_000;
const METRIC_INTERVAL_MS = 60_000;
// Request durations in seconds; few buckets keep the series count small.
const DURATION_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

let started:
  | { telemetry: Telemetry; instrumentations: Instrumentation[] }
  | undefined;

export const telemetryStarted = () => started !== undefined;
export const startedInstrumentations = () => started?.instrumentations ?? [];

// Export failures are reported as JSON error lines, masked; the request
// that caused the export never sees them.
const diagLogger: DiagLogger = {
  debug: () => undefined,
  error: (message) =>
    console.error(
      JSON.stringify({
        level: 'error',
        message: `telemetry: ${scrub(message)}`,
      }),
    ),
  info: () => undefined,
  verbose: () => undefined,
  warn: () => undefined,
};

export function resourceFor(
  service: Service,
  env: string,
  release: string | undefined,
) {
  const { resourceFromAttributes } =
    require('@opentelemetry/resources') as typeof import('@opentelemetry/resources');
  return resourceFromAttributes({
    'deployment.environment': env,
    'service.name': service,
    'service.version': release || 'dev',
  });
}

// Starts tracing, metrics and logs for one process, once, when
// OTEL_EXPORTER_OTLP_ENDPOINT is set. Unset, nothing is loaded or
// registered. A malformed setting writes one error line and leaves
// telemetry off: it never stops the service. The OTLP exporters read
// OTEL_EXPORTER_OTLP_HEADERS from the environment themselves.
export function startTelemetry(
  service: Service,
  source: Record<string, string | undefined> = process.env,
  exporters: Exporters = {},
): Telemetry | undefined {
  if (started) return started.telemetry;
  try {
    return boot(service, source, exporters);
  } catch (error) {
    // Whatever registered before the failure is taken back, so the
    // process runs as it does with telemetry off.
    trace.disable();
    context.disable();
    propagation.disable();
    metrics.disable();
    logs.disable();
    console.error(
      JSON.stringify({ level: 'error', message: (error as Error).message }),
    );
    return undefined;
  }
}

function boot(
  service: Service,
  source: Record<string, string | undefined>,
  exporters: Exporters,
): Telemetry | undefined {
  const settings = telemetry(source);
  if (!settings) return undefined;
  const { endpoint, env, traceSampleRatio } = settings;
  diag.setLogger(diagLogger, DiagLogLevel.ERROR);

  const { BatchSpanProcessor, NodeTracerProvider } =
    require('@opentelemetry/sdk-trace-node') as typeof import('@opentelemetry/sdk-trace-node');
  const {
    AggregationType,
    createAllowListAttributesProcessor,
    MeterProvider,
    PeriodicExportingMetricReader,
  } =
    require('@opentelemetry/sdk-metrics') as typeof import('@opentelemetry/sdk-metrics');
  const { BatchLogRecordProcessor, LoggerProvider } =
    require('@opentelemetry/sdk-logs') as typeof import('@opentelemetry/sdk-logs');
  const { registerInstrumentations } =
    require('@opentelemetry/instrumentation') as typeof import('@opentelemetry/instrumentation');
  const { ScrubSpanProcessor } =
    require('../scrub/span-processor') as typeof import('../scrub/span-processor');
  const { gaugeDelta } =
    require('./temporality') as typeof import('./temporality');

  const base = endpoint.href.replace(/\/$/, '');
  const otlp = (signal: string) => ({
    compression: 'gzip' as never,
    timeoutMillis: EXPORT_TIMEOUT_MS,
    url: `${base}/v1/${signal}`,
  });
  const resource = resourceFor(service, env, source['RELEASE_SHA']);

  const tracerProvider = new NodeTracerProvider({
    resource,
    sampler: sampler(traceSampleRatio),
    spanProcessors: [
      new ScrubSpanProcessor(
        new BatchSpanProcessor(
          exporters.spanExporter ??
            new (
              require('@opentelemetry/exporter-trace-otlp-proto') as typeof import('@opentelemetry/exporter-trace-otlp-proto')
            ).OTLPTraceExporter(otlp('traces')),
          { exportTimeoutMillis: EXPORT_TIMEOUT_MS },
        ),
        URL.parse(source['DATABASE_URL'] ?? '')?.hostname || undefined,
      ),
    ],
  });
  tracerProvider.register();

  const histogram = (instrumentName: string, keys: string[]) => ({
    aggregation: {
      options: { boundaries: DURATION_BUCKETS },
      type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
    },
    attributesProcessors: [createAllowListAttributesProcessor(keys)],
    instrumentName,
  });
  const drop = (instrumentName: string) => ({
    aggregation: { type: AggregationType.DROP },
    instrumentName,
  });
  const metricExporter = () => {
    const exporter = new (
      require('@opentelemetry/exporter-metrics-otlp-proto') as typeof import('@opentelemetry/exporter-metrics-otlp-proto')
    ).OTLPMetricExporter(otlp('metrics'));
    exporter.selectAggregationTemporality = gaugeDelta;
    return exporter;
  };
  const meterProvider = new MeterProvider({
    readers: [
      exporters.metricReader ??
        new PeriodicExportingMetricReader({
          exporter: metricExporter(),
          exportIntervalMillis: METRIC_INTERVAL_MS,
          exportTimeoutMillis: EXPORT_TIMEOUT_MS,
        }),
    ],
    resource,
    views: [
      histogram('http.server.request.duration', [
        'http.request.method',
        'http.response.status_code',
        'http.route',
      ]),
      histogram('http.client.request.duration', [
        'http.request.method',
        'http.response.status_code',
        'server.address',
      ]),
      histogram('motorfix_storage_request_duration_seconds', ['operation']),
      // The runtime figures kept: heap used and limit, the event loop's
      // p99 delay and utilisation, GC durations. The rest only add series.
      drop('v8js.memory.heap.space.*'),
      drop('nodejs.eventloop.delay.min'),
      drop('nodejs.eventloop.delay.max'),
      drop('nodejs.eventloop.delay.mean'),
      drop('nodejs.eventloop.delay.stddev'),
      drop('nodejs.eventloop.delay.p50'),
      drop('nodejs.eventloop.delay.p90'),
    ],
  });
  metrics.setGlobalMeterProvider(meterProvider);

  const loggerProvider = new LoggerProvider({
    processors: [
      new BatchLogRecordProcessor({
        exporter:
          exporters.logExporter ??
          new (
            require('@opentelemetry/exporter-logs-otlp-proto') as typeof import('@opentelemetry/exporter-logs-otlp-proto')
          ).OTLPLogExporter(otlp('logs')),
        exportTimeoutMillis: EXPORT_TIMEOUT_MS,
      }),
    ],
    resource,
  });
  logs.setGlobalLoggerProvider(loggerProvider);

  const instrumented = instrumentations();
  registerInstrumentations({ instrumentations: instrumented });
  observeCpu(metrics.getMeter('motorfix'));

  const flush = async () => {
    await Promise.allSettled([
      tracerProvider.forceFlush(),
      meterProvider.forceFlush(),
      loggerProvider.forceFlush(),
    ]);
  };
  const shutdown = async () => {
    await Promise.allSettled([
      tracerProvider.shutdown(),
      meterProvider.shutdown(),
      loggerProvider.shutdown(),
    ]);
  };
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      // Nest's shutdown hooks, when present, end the process themselves;
      // alone, the signal is raised again once the last batch is out.
      const others = process.listenerCount(signal);
      void shutdown().finally(() => {
        if (others === 0) process.kill(process.pid, signal);
      });
    });
  }

  const value: Telemetry = { endpoint, env, flush, shutdown, traceSampleRatio };
  started = { instrumentations: instrumented, telemetry: value };
  return value;
}
