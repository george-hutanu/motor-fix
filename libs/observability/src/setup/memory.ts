import { readFileSync } from 'node:fs';

import type { Meter } from '@opentelemetry/api';

const CGROUP_V2 = '/sys/fs/cgroup/memory.max';
const CGROUP_V1 = '/sys/fs/cgroup/memory/memory.limit_in_bytes';
// cgroup v1 writes a page-aligned 2^63 when the container has no limit.
const UNLIMITED = 2 ** 62;

const readText = (path: string) => readFileSync(path, 'utf8');

// The container's memory limit in bytes, or undefined when it has none or
// the kernel does not say: cgroup v2 first, then v1.
export function cgroupLimit(read: (path: string) => string = readText) {
  for (const path of [CGROUP_V2, CGROUP_V1]) {
    let text: string;
    try {
      text = read(path).trim();
    } catch {
      continue;
    }
    const bytes = Number(text);
    return Number.isSafeInteger(bytes) && bytes > 0 && bytes < UNLIMITED
      ? bytes
      : undefined;
  }
  return undefined;
}

// The process's resident memory and its container's limit, so an alert can
// fire before the platform kills the process for running out.
export function observeMemory(
  meter: Meter,
  limit: () => number | undefined = cgroupLimit,
): void {
  meter
    .createObservableGauge('process.memory.usage', {
      description: 'Resident memory of the process',
      unit: 'By',
    })
    .addCallback((result) => result.observe(process.memoryUsage.rss()));
  meter
    .createObservableGauge('motorfix_process_memory_limit_bytes', {
      description: "Memory limit of the process's container",
      unit: 'By',
    })
    .addCallback((result) => {
      const bytes = limit();
      if (bytes !== undefined) result.observe(bytes);
    });
}
