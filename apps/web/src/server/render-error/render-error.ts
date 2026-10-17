import { logEntry, setRoute } from '@motor-fix/observability';
import { scrub } from '@motor-fix/observability/scrub';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { ErrorRequestHandler } from 'express';

// A request that ended in a server error: its span is marked failed, and one
// masked entry goes to stderr and the log exporter. A caller that names the
// failure gives its own message, and the error's goes beside it as `error`.
export function reportServerError(
  error: unknown,
  message?: string,
  attributes: Record<string, string> = {},
): void {
  const cause = scrub(error instanceof Error ? error.message : String(error));
  const stack =
    error instanceof Error && error.stack ? scrub(error.stack) : undefined;
  const span = trace.getActiveSpan();
  span?.recordException({ message: cause, name: 'Error', stack });
  span?.setStatus({ code: SpanStatusCode.ERROR, message: cause });
  logEntry('error', message ?? cause, {
    ...attributes,
    ...(message && { error: cause }),
    stack,
  });
}

// A page that failed to render: reported as above and named `unmatched`, and
// the visitor gets a bare 500 with nothing of the error.
export const renderError: ErrorRequestHandler = (error, _req, res, _next) => {
  reportServerError(error);
  setRoute('unmatched');
  if (res.headersSent) res.destroy();
  else res.status(500).end();
};
