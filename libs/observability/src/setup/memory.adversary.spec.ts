import { type DataPoint, MeterProvider } from '@opentelemetry/sdk-metrics';

import { cgroupLimit, observeMemory } from './memory';
import { inMemory } from '../testing/in-memory';

const V2 = '/sys/fs/cgroup/memory.max';
const V1 = '/sys/fs/cgroup/memory/memory.limit_in_bytes';
const LIMIT = 'motorfix_process_memory_limit_bytes';

const files =
  (contents: Record<string, string>) =>
  (path: string): string => {
    const text = contents[path];
    if (text === undefined) throw new Error(`ENOENT: ${path}`);
    return text;
  };

function observe(limit?: () => number | undefined) {
  const reader = inMemory().metricReader;
  observeMemory(
    new MeterProvider({ readers: [reader] }).getMeter('motorfix'),
    limit,
  );
  return async () => {
    const { resourceMetrics } = await reader.collect();
    return new Map(
      resourceMetrics.scopeMetrics
        .flatMap((scope) => scope.metrics)
        .map((m) => [
          m.descriptor.name,
          (m.dataPoints as DataPoint<number>[]).map((p) => ({
            attributes: p.attributes,
            value: p.value,
          })),
        ]),
    );
  };
}

describe('the container memory limit under hostile files', () => {
  // @traces 880-FR-006
  it.each([
    ['a negative number', '-1\n'],
    ['an empty file', ''],
    ['only whitespace', '  \n'],
    ['infinity', 'Infinity\n'],
    ['not a number', 'NaN\n'],
    ['a number with a unit', '512MB\n'],
    ['a number with trailing text', '1073741824 bytes\n'],
    ['a fraction below one byte', '0.5\n'],
    ['unicode digits', '٥١٢\n'],
  ])('has no limit when cgroup v2 holds %s and v1 is absent', (_n, text) => {
    expect(cgroupLimit(files({ [V2]: text }))).toBeUndefined();
  });

  // @traces 880-FR-006
  it.each([
    ['a negative number', '-1\n'],
    ['an empty file', ''],
    ['a number with a unit', '512MB\n'],
  ])('has no limit when cgroup v1 holds %s and v2 is absent', (_n, text) => {
    expect(cgroupLimit(files({ [V1]: text }))).toBeUndefined();
  });

  // @traces 880-FR-006
  it('accepts a value padded with whitespace and a Windows line ending', () => {
    expect(cgroupLimit(files({ [V2]: '  268435456\r\n' }))).toBe(268_435_456);
  });

  // @traces 880-FR-006
  it('reports a limit just below the unlimited threshold', () => {
    expect(cgroupLimit(files({ [V2]: `${2 ** 61}\n` }))).toBe(2 ** 61);
  });

  // @traces 880-FR-006
  it('reports the smallest positive limit', () => {
    expect(cgroupLimit(files({ [V2]: '1\n' }))).toBe(1);
  });

  // @traces 880-FR-006
  it('has no limit when a value is far beyond the unlimited threshold', () => {
    expect(
      cgroupLimit(files({ [V2]: '99999999999999999999999999\n' })),
    ).toBeUndefined();
  });

  // @traces 880-FR-006
  it('does not throw when the reader fails with a non-error value', () => {
    const read = () => {
      throw 'EACCES';
    };
    expect(cgroupLimit(read)).toBeUndefined();
  });

  // @traces 880-FR-006
  it('reads nothing but the two cgroup paths', () => {
    const seen: string[] = [];
    cgroupLimit((path) => {
      seen.push(path);
      throw new Error('ENOENT');
    });
    expect(seen).toEqual([V2, V1]);
  });

  // @traces 880-FR-006
  it('does not read cgroup v1 once v2 gave a limit', () => {
    const seen: string[] = [];
    cgroupLimit((path) => {
      seen.push(path);
      return '1048576';
    });
    expect(seen).toEqual([V2]);
  });
});

describe('the memory readings under hostile limits', () => {
  // @traces 880-FR-006
  it.each([
    ['NaN', Number.NaN],
    ['zero', 0],
    ['negative', -5],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('observes no limit when the limit is %s', async (_n, value) => {
    const found = await observe(() => value)();
    expect(found.get(LIMIT) ?? []).toEqual([]);
    expect(found.get('process.memory.usage')).toHaveLength(1);
  });

  // @traces 880-FR-006
  it('still reports the usage when the limit reader throws', async () => {
    const collect = observe(() => {
      throw new Error('boom');
    });
    const found = await collect();
    expect(found.get('process.memory.usage')).toHaveLength(1);
    expect(found.get(LIMIT) ?? []).toEqual([]);
  });

  // @traces 880-FR-006
  it('reads the limit again on every collection', async () => {
    const answers: (number | undefined)[] = [undefined, 1_000_000, undefined];
    const collect = observe(() => answers.shift());
    const values = [] as (number | undefined)[];
    for (let i = 0; i < 3; i++) {
      values.push((await collect()).get(LIMIT)?.[0]?.value);
    }
    expect(values).toEqual([undefined, 1_000_000, undefined]);
  });

  // @traces 880-FR-006
  it('observes one point per reading carrying no attributes of its own', async () => {
    const found = await observe(() => 2_147_483_648)();
    expect(found.get('process.memory.usage')?.map((p) => p.attributes)).toEqual(
      [{}],
    );
    expect(found.get(LIMIT)).toEqual([
      { attributes: {}, value: 2_147_483_648 },
    ]);
  });

  // @traces 880-FR-006
  it('reports a usage that is a whole number of bytes', async () => {
    const [point] = (await observe()()).get('process.memory.usage') ?? [];
    expect(Number.isInteger(point?.value)).toBe(true);
  });
});
