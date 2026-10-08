import type { Meter } from '@opentelemetry/api';

// CPU time of the process by mode, in seconds; the runtime instrumentation
// does not report it.
export function observeCpu(meter: Meter): void {
  meter
    .createObservableCounter('process.cpu.time', {
      description: 'CPU time used by the process',
      unit: 's',
    })
    .addCallback((result) => {
      const usage = process.cpuUsage();
      result.observe(usage.user / 1e6, { 'cpu.mode': 'user' });
      result.observe(usage.system / 1e6, { 'cpu.mode': 'system' });
    });
}
