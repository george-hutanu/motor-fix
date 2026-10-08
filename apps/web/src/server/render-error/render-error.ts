import { setRoute } from '@motor-fix/observability';
import { scrub } from '@motor-fix/observability/scrub';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import type { ErrorRequestHandler } from 'express';

// A page that failed to render: the request span is marked failed and named
// `unmatched`, one masked JSON line goes to stdout and the same entry to the
// log exporter, and the visitor gets a bare 500 with nothing of the error.
export const renderError: ErrorRequestHandler = (error, _req, res, _next) => {
  const message = scrub(error instanceof Error ? error.message : String(error));
  const stack =
    error instanceof Error && error.stack ? scrub(error.stack) : undefined;
  const span = trace.getActiveSpan();
  span?.recordException({ message, name: 'Error', stack });
  span?.setStatus({ code: SpanStatusCode.ERROR, message });
  setRoute('unmatched');
  const ids = span?.spanContext();
  console.error(
    JSON.stringify({
      level: 'error',
      message,
      ...(stack && { stack }),
      ...(ids && { span_id: ids.spanId, trace_id: ids.traceId }),
    }),
  );
  logs.getLogger('motorfix').emit({
    attributes: stack ? { stack } : {},
    body: message,
    severityNumber: SeverityNumber.ERROR,
    severityText: 'ERROR',
  });
  if (res.headersSent) res.destroy();
  else res.status(500).end();
};
