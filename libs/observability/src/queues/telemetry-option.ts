import type { Telemetry } from 'bullmq';

import { telemetryStarted } from '../setup/start';

let instance: Telemetry | undefined;

// The `telemetry` option of every Queue and Worker: it carries the trace
// context with the job, so a job continues the request that queued it.
// Undefined while telemetry is off, which leaves bullmq as it was.
export function queueTelemetry(): Telemetry | undefined {
  if (!telemetryStarted()) return undefined;
  if (instance) return instance;
  try {
    const { BullMQOtel } =
      require('bullmq-otel') as typeof import('bullmq-otel');
    instance = new BullMQOtel({
      tracerName: 'motorfix',
    }) as unknown as Telemetry;
  } catch (error) {
    // Jobs still run, only without their trace context.
    console.error(
      JSON.stringify({ level: 'error', message: (error as Error).message }),
    );
  }
  return instance;
}
