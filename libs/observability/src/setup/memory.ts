import { readFileSync } from 'node:fs';

import type { Meter } from '@opentelemetry/api';

const CGROUP_V2 = '/sys/fs/cgroup/memory.max';
const CGROUP_V1 = '/sys/fs/cgroup/memory/memory.limit_in_bytes';
// cgroup v1 writes a page-aligned value just under 2^63 when the container
// has no limit; anything from 2^62 up is read as no limit.
const UNLIMITED = 2 ** 62;

const readText = (path: string) => readFileSync(path, 'utf8');

const isLimit = (bytes: number | undefined): bytes is number =>
  bytes !== undefined &&
  Number.isFinite(bytes) &&
  bytes > 0 &&
  bytes < UNLIMITED;

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
    const bytes = /^\d+$/.test(text) ? Number(text) : undefined;
    return isLimit(bytes) ? bytes : undefined;
  }
  return undefined;
}

// The process's resident memory and its container's limit, so an alert can
// fire before the platform kills the process for running out. A limit that
// cannot be read, or is not a positive byte count, is not observed.
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
      let bytes: number | undefined;
      try {
        bytes = limit();
      } catch {
        return;
      }
      if (isLimit(bytes)) result.observe(bytes);
    });
}
