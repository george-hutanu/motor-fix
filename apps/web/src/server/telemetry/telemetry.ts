import { faroUrl } from '@motor-fix/contracts/env';
import * as observability from '@motor-fix/observability';

type Observability = Pick<
  typeof observability,
  'logEntry' | 'startTelemetry' | 'telemetryStarted'
>;

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
