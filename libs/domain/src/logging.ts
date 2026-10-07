import { AsyncLocalStorage } from 'node:async_hooks';

import { scrubDeep } from '@motor-fix/observability';
import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import {
  type LogAttributes,
  logs,
  SeverityNumber,
} from '@opentelemetry/api-logs';

export const requestContext = new AsyncLocalStorage<{
  requestId?: string;
  jobId?: string;
}>();

// Runs a job's work and its failure log with the job id on every line.
export function inJob<T>(job: { id?: string } | undefined, run: () => T): T {
  return requestContext.run(job?.id ? { jobId: job.id } : {}, run);
}

const SEVERITY: Record<LogLevel, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  error: SeverityNumber.ERROR,
  fatal: SeverityNumber.FATAL,
  log: SeverityNumber.INFO,
  verbose: SeverityNumber.TRACE,
  warn: SeverityNumber.WARN,
};

// One JSON line per entry on stdout, with personal values masked, the
// request or job it belongs to and the active trace; the same entry goes to
// the log exporter when telemetry is on (a no-op otherwise).
export class JsonLogger extends ConsoleLogger {
  constructor() {
    super({ json: true });
  }

  protected override getJsonLogObject(
    message: unknown,
    options: { context: string; logLevel: LogLevel; errorStack?: unknown },
  ) {
    const { jobId, requestId } = requestContext.getStore() ?? {};
    const span = trace.getActiveSpan()?.spanContext();
    const line = scrubDeep({
      ...super.getJsonLogObject(message, options),
      ...(requestId && { requestId }),
      ...(jobId && { jobId }),
      ...(span && { span_id: span.spanId, trace_id: span.traceId }),
    });
    const {
      message: body,
      level,
      timestamp,
      pid,
      ...attributes
    } = line as Record<string, unknown>;
    logs.getLogger('motorfix').emit({
      attributes: attributes as LogAttributes,
      body: typeof body === 'string' ? body : JSON.stringify(body),
      severityNumber: SEVERITY[options.logLevel],
      severityText:
        options.logLevel === 'log' ? 'INFO' : options.logLevel.toUpperCase(),
    });
    return line;
  }
}
