import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';

// Vitest can run several spec files in one worker, and the OpenTelemetry API
// keeps its providers on a process-wide global that outlives a file's
// modules: each file starts with none registered, as it did under Jest. Once
// per file, before the spec loads, since many specs start telemetry at load.
trace.disable();
context.disable();
propagation.disable();
metrics.disable();
logs.disable();
