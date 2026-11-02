import { faroUrl } from '@motor-fix/contracts/env';
import {
  logEntry,
  startTelemetry,
  telemetryStarted,
} from '@motor-fix/observability';

// Named, not a namespace: a namespace passed as a value keeps the whole
// library in the server bundle.
const observability = { logEntry, startTelemetry, telemetryStarted };
type Observability = typeof observability;

// Takes the library as an argument so a spec can pass a double: the unit-test
// build bundles @motor-fix/observability, where a module mock cannot reach.
export function startWebTelemetry(lib: Observability = observability): void {
  lib.startTelemetry('web');
  // The server reports, but no browser reading reaches the Web Vitals board.
  if (lib.telemetryStarted() && !faroUrl()) {
    lib.logEntry('warn', 'browser telemetry off: FARO_URL unset');
  }
}

startWebTelemetry();
