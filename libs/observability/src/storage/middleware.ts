import {
  type Counter,
  type Histogram,
  metrics,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';

import { telemetryStarted } from '../setup/start';

// The shape of an initialize-step middleware on an AWS SDK v3 client's
// middlewareStack, without the SDK as a dependency of this library.
type Handler<A, R> = (args: A) => Promise<R>;
type StorageMiddleware = <A, R>(
  next: Handler<A, R>,
  context: { commandName?: string },
) => Handler<A, R>;

let instruments: { duration: Histogram; requests: Counter } | undefined;

const statusOf = (error: unknown) =>
  (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata
    ?.httpStatusCode;

// The exception event keeps the error's name only: an S3 message can quote
// the key, which never reaches telemetry.
function failed(span: Span, error: unknown) {
  const name = (error as Error | null)?.name;
  span.recordException({ name: typeof name === 'string' ? name : 'Error' });
  span.setStatus({ code: SpanStatusCode.ERROR });
}

// Every object-store call as a client span `S3 <Operation>` carrying the
// bucket (never the key), counted in motorfix_storage_requests_total by
// operation and outcome and timed in its duration histogram. A 404 is an
// answer (a missing object is a normal reply), so it counts as ok and leaves
// the span unset; the rejection still reaches the caller unchanged.
// Undefined while telemetry is off, which leaves the client as it was.
export function storageTelemetry(
  bucket: string,
): StorageMiddleware | undefined {
  if (!telemetryStarted()) return undefined;
  const meter = metrics.getMeter('motorfix');
  instruments ??= {
    duration: meter.createHistogram(
      'motorfix_storage_request_duration_seconds',
      { description: 'Object-store call duration', unit: 's' },
    ),
    requests: meter.createCounter('motorfix_storage_requests_total', {
      description: 'Object-store calls by operation and outcome',
    }),
  };
  const { duration, requests } = instruments;
  const tracer = trace.getTracer('motorfix');
  return (next, context) => (args) => {
    const operation = (context.commandName ?? 'Unknown').replace(
      /Command$/,
      '',
    );
    const started = performance.now();
    const done = (outcome: 'ok' | 'error') => {
      requests.add(1, { operation, outcome });
      duration.record((performance.now() - started) / 1000, { operation });
    };
    return tracer.startActiveSpan(
      `S3 ${operation}`,
      {
        attributes: {
          'aws.s3.bucket': bucket,
          'rpc.method': operation,
          'rpc.service': 'S3',
          'rpc.system': 'aws-api',
        },
        kind: SpanKind.CLIENT,
      },
      (span) => traced(span, () => next(args), done),
    );
  };
}

async function traced<R>(
  span: Span,
  run: () => Promise<R>,
  done: (outcome: 'ok' | 'error') => void,
): Promise<R> {
  try {
    const result = await run();
    done('ok');
    return result;
  } catch (error) {
    const answered = statusOf(error) === 404;
    done(answered ? 'ok' : 'error');
    if (!answered) failed(span, error);
    throw error;
  } finally {
    span.end();
  }
}
