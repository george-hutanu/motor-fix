import { startTelemetry } from '@motor-fix/observability';

// Imported first by main.ts, so the instrumentations load before what they
// patch.
startTelemetry('worker');
