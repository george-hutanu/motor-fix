import { trace } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';

import { scrub } from '../scrub/scrub';

type Attributes = Record<string, string | number | boolean | undefined>;

const SEVERITY = {
  error: { number: SeverityNumber.ERROR, text: 'ERROR' },
  warn: { number: SeverityNumber.WARN, text: 'WARN' },
} as const;

// One masked JSON line (stdout for a warning, stderr for an error) and the
// same entry as an OTel record, which is a no-op while telemetry is off.
// Pass a variable's name in the message, never its value.
export function logEntry(
  level: 'warn' | 'error',
  message: string,
  attributes: Attributes = {},
): void {
  const body = scrub(message);
  const masked = Object.fromEntries(
    Object.entries(attributes)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [
        key,
        typeof value === 'string' ? scrub(value) : value,
      ]),
  ) as Record<string, string | number | boolean>;
  const ids = trace.getActiveSpan()?.spanContext();
  // The entry's own fields come last: an attribute never overrides them.
  const line = JSON.stringify({
    ...masked,
    ...(ids && { span_id: ids.spanId, trace_id: ids.traceId }),
    level,
    message: body,
  });
  if (level === 'error') console.error(line);
  else console.log(line);
  logs.getLogger('motorfix').emit({
    attributes: masked,
    body,
    severityNumber: SEVERITY[level].number,
    severityText: SEVERITY[level].text,
  });
}
