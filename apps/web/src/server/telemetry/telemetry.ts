import { faroUrl } from '@motor-fix/contracts/env';
import {
  logEntry,
  startTelemetry,
  telemetryStarted,
} from '@motor-fix/observability';

startTelemetry('web');
// The server reports, but no browser reading reaches the Web Vitals board.
if (telemetryStarted() && !faroUrl()) {
  logEntry('warn', 'browser telemetry off: FARO_URL unset');
}
