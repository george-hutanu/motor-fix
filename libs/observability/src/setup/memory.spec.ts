import { type DataPoint, MeterProvider } from '@opentelemetry/sdk-metrics';

import { cgroupLimit, observeMemory } from './memory';
import { inMemory } from '../testing/in-memory';

const V2 = '/sys/fs/cgroup/memory.max';
const V1 = '/sys/fs/cgroup/memory/memory.limit_in_bytes';

const files =
  (contents: Record<string, string>) =>
  (path: string): string => {
    const text = contents[path];
    if (text === undefined) throw new Error(`ENOENT: ${path}`);
    return text;
  };

async function readings(limit: () => number | undefined) {
  const reader = inMemory().metricReader;
  observeMemory(
    new MeterProvider({ readers: [reader] }).getMeter('motorfix'),
    limit,
  );
  const { resourceMetrics } = await reader.collect();
  return resourceMetrics.scopeMetrics.flatMap((scope) => scope.metrics);
}

describe('the process memory readings', () => {
  // @traces 880-FR-006
  it('records the resident memory in bytes', async () => {
    const found = (await readings(() => undefined)).find(
      (metric) => metric.descriptor.name === 'process.memory.usage',
    );
    expect(found?.descriptor.unit).toBe('By');
    const [point] = (found?.dataPoints ?? []) as DataPoint<number>[];
    expect(point.value).toBeGreaterThan(1024 * 1024);
  });

  // @traces 880-FR-006
  it('records the container limit in bytes when there is one', async () => {
    const found = (await readings(() => 536_870_912)).find(
      (metric) =>
        metric.descriptor.name === 'motorfix_process_memory_limit_bytes',
    );
    expect(found?.descriptor.unit).toBe('By');
    expect(
      ((found?.dataPoints ?? []) as DataPoint<number>[]).map((p) => p.value),
    ).toEqual([536_870_912]);
  });

  // @traces 880-FR-006
  it('records no limit when the container has none', async () => {
    const found = (await readings(() => undefined)).find(
      (metric) =>
        metric.descriptor.name === 'motorfix_process_memory_limit_bytes',
    );
    expect(found?.dataPoints ?? []).toEqual([]);
  });
});

describe('the container memory limit', () => {
  // @traces 880-FR-006
  it('reads cgroup v2 first', () => {
    expect(cgroupLimit(files({ [V2]: '536870912\n', [V1]: '1024\n' }))).toBe(
      536_870_912,
    );
  });

  // @traces 880-FR-006
  it('has no limit when cgroup v2 says max', () => {
    expect(cgroupLimit(files({ [V2]: 'max\n' }))).toBeUndefined();
  });

  // @traces 880-FR-006
  it('falls back to cgroup v1', () => {
    expect(cgroupLimit(files({ [V1]: '1073741824\n' }))).toBe(1_073_741_824);
  });

  // @traces 880-FR-006
  it('has no limit when cgroup v1 holds its unlimited value', () => {
    expect(
      cgroupLimit(files({ [V1]: '9223372036854771712\n' })),
    ).toBeUndefined();
    expect(cgroupLimit(files({ [V1]: `${2 ** 62}\n` }))).toBeUndefined();
  });

  // @traces 880-FR-006
  it('has no limit when neither file can be read or holds a number', () => {
    expect(cgroupLimit(files({}))).toBeUndefined();
    expect(cgroupLimit(files({ [V2]: 'garbage' }))).toBeUndefined();
    expect(cgroupLimit(files({ [V1]: '0\n' }))).toBeUndefined();
  });
});
