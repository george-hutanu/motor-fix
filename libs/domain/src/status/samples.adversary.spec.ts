import { medianLatency, recordSample, type SampleStore } from './samples';

function store() {
  const sets = new Map<string, Map<string, number>>();
  const ttl = new Map<string, number>();
  const bound = (value: number | string) => {
    const text = String(value).replace('inf', 'Infinity');
    const open = text.startsWith('(');
    return { n: Number(open ? text.slice(1) : text), open };
  };
  const inside = (
    score: number,
    min: number | string,
    max: number | string,
  ) => {
    const lo = bound(min);
    const hi = bound(max);
    return (
      (lo.open ? score > lo.n : score >= lo.n) &&
      (hi.open ? score < hi.n : score <= hi.n)
    );
  };
  const fake = {
    expire: async (key: string, seconds: number) => {
      ttl.set(key, seconds);
      return 1;
    },
    zadd: async (key: string, score: number | string, member: string) => {
      const set = sets.get(key) ?? new Map<string, number>();
      set.set(member, Number(score));
      sets.set(key, set);
      return 1;
    },
    zrangebyscore: async (
      key: string,
      min: number | string,
      max: number | string,
    ) =>
      [...(sets.get(key) ?? [])]
        .filter(([, score]) => inside(score, min, max))
        .sort((a, b) => a[1] - b[1])
        .map(([member]) => member),
    zremrangebyscore: async (
      key: string,
      min: number | string,
      max: number | string,
    ) => {
      const set = sets.get(key) ?? new Map<string, number>();
      let removed = 0;
      for (const [member, score] of [...set]) {
        if (inside(score, min, max)) {
          set.delete(member);
          removed++;
        }
      }
      return removed;
    },
  };
  return { sets, store: fake as unknown as SampleStore, ttl };
}

const base = Date.parse('2026-10-17T10:00:00Z');
const at = (seconds: number) => new Date(base + seconds * 1000);

// @traces 294-FR-004
describe('the sample window under attack', () => {
  it('is null with no samples', async () => {
    expect(await medianLatency(store().store, 'api', at(0))).toBeNull();
  });

  it('counts two equal latencies recorded in the same millisecond as two samples', async () => {
    const { store: s } = store();
    await recordSample(s, 'api', 100, at(0));
    await recordSample(s, 'api', 100, at(0));
    await recordSample(s, 'api', 900, at(0));
    expect(await medianLatency(s, 'api', at(0))).toBe(100);
  });

  it('counts different latencies recorded in the same millisecond separately', async () => {
    const { store: s } = store();
    await recordSample(s, 'api', 100, at(0));
    await recordSample(s, 'api', 300, at(0));
    expect(await medianLatency(s, 'api', at(0))).toBe(200);
  });

  it('keeps a zero latency as a real sample', async () => {
    const { store: s } = store();
    await recordSample(s, 'api', 0, at(0));
    expect(await medianLatency(s, 'api', at(0))).toBe(0);
  });

  it('is the middle one of three whatever order they arrived in', async () => {
    const { store: s } = store();
    await recordSample(s, 'api', 900, at(0));
    await recordSample(s, 'api', 5, at(10));
    await recordSample(s, 'api', 70, at(20));
    expect(await medianLatency(s, 'api', at(20))).toBe(70);
  });

  it('is the mean of the middle two of four', async () => {
    const { store: s } = store();
    for (const [i, ms] of [10, 20, 30, 1000].entries()) {
      await recordSample(s, 'api', ms, at(i));
    }
    expect(await medianLatency(s, 'api', at(5))).toBe(25);
  });

  it('is not moved by one huge outlier among many', async () => {
    const { store: s } = store();
    for (let i = 0; i < 9; i++) await recordSample(s, 'api', 100, at(i));
    await recordSample(s, 'api', 9_999_999, at(9));
    expect(await medianLatency(s, 'api', at(10))).toBe(100);
  });

  it('leaves out a sample older than five minutes and keeps one just inside', async () => {
    const { store: s } = store();
    await recordSample(s, 'api', 5000, at(-301));
    await recordSample(s, 'api', 40, at(-299));
    expect(await medianLatency(s, 'api', at(0))).toBe(40);
  });

  it('is null when every sample is older than five minutes', async () => {
    const { store: s } = store();
    await recordSample(s, 'api', 40, at(-400));
    expect(await medianLatency(s, 'api', at(0))).toBeNull();
  });

  it('keeps the tiles apart', async () => {
    const { store: s } = store();
    await recordSample(s, 'api', 40, at(0));
    await recordSample(s, 'search', 4000, at(0));
    expect(await medianLatency(s, 'api', at(0))).toBe(40);
    expect(await medianLatency(s, 'search', at(0))).toBe(4000);
    expect(await medianLatency(s, 'maps', at(0))).toBeNull();
  });

  it('stores under status:samples:{tile} with a ten minute expiry', async () => {
    const fake = store();
    await recordSample(fake.store, 'email', 40, at(0));
    expect([...fake.sets.keys()]).toEqual(['status:samples:email']);
    expect(fake.ttl.get('status:samples:email')).toBe(600);
  });

  it('drops samples older than ten minutes when a new one is recorded', async () => {
    const fake = store();
    await recordSample(fake.store, 'api', 1, at(-601));
    await recordSample(fake.store, 'api', 2, at(-599));
    await recordSample(fake.store, 'api', 3, at(0));
    expect(fake.sets.get('status:samples:api')?.size).toBe(2);
  });

  it('gives the same median when asked twice', async () => {
    const { store: s } = store();
    await recordSample(s, 'api', 10, at(0));
    await recordSample(s, 'api', 30, at(1));
    const first = await medianLatency(s, 'api', at(2));
    expect(await medianLatency(s, 'api', at(2))).toBe(first);
  });

  it('does not change when read: reading adds no sample', async () => {
    const fake = store();
    await recordSample(fake.store, 'api', 10, at(0));
    await medianLatency(fake.store, 'api', at(1));
    expect(fake.sets.get('status:samples:api')?.size).toBe(1);
  });

  it('gives the median of ten thousand samples', async () => {
    const { store: s } = store();
    for (let i = 0; i < 10_000; i++) {
      await recordSample(s, 'api', i, new Date(base + i));
    }
    expect(await medianLatency(s, 'api', new Date(base + 10_000))).toBe(4999.5);
  });

  it('passes on a store failure instead of inventing a median', async () => {
    const broken = {
      zrangebyscore: async () => {
        throw new Error('redis down');
      },
    } as unknown as SampleStore;
    await expect(medianLatency(broken, 'api', at(0))).rejects.toThrow(
      'redis down',
    );
  });
});
