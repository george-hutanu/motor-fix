import { medianLatency, recordSample, type SampleStore } from './samples';

// An in-memory sorted set per key, with the commands the samples use.
function fakeStore() {
  const sets = new Map<string, Map<string, number>>();
  const ttl = new Map<string, number>();
  // A Redis score bound: a number, "(n" for exclusive, or -inf and +inf.
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
  const store = {
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
      [...(sets.get(key) ?? new Map<string, number>())]
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
      for (const [member, score] of set) {
        if (inside(score, min, max)) {
          set.delete(member);
          removed += 1;
        }
      }
      return removed;
    },
  };
  return { sets, store: store as unknown as SampleStore, ttl };
}

const base = new Date('2026-10-17T10:00:00Z').getTime();
const at = (seconds: number) => new Date(base + seconds * 1000);

// @traces 294-FR-004
// @traces 294-FR-012
describe('the latency samples', () => {
  it('gives no median for a tile with no sample', async () => {
    const { store } = fakeStore();
    expect(await medianLatency(store, 'api', at(0))).toBeNull();
  });

  it('gives the one sample when there is only one', async () => {
    const { store } = fakeStore();
    await recordSample(store, 'api', 120, at(0));
    expect(await medianLatency(store, 'api', at(0))).toBe(120);
  });

  it('gives the middle sample of an odd count', async () => {
    const { store } = fakeStore();
    for (const [n, ms] of [900, 100, 300, 5000, 200].entries()) {
      await recordSample(store, 'search', ms, at(n * 30));
    }
    expect(await medianLatency(store, 'search', at(120))).toBe(300);
  });

  it('gives the mean of the two middle samples of an even count', async () => {
    const { store } = fakeStore();
    for (const [n, ms] of [100, 400, 200, 3000].entries()) {
      await recordSample(store, 'search', ms, at(n * 30));
    }
    expect(await medianLatency(store, 'search', at(90))).toBe(300);
  });

  it('keeps two samples of the same latency apart', async () => {
    const { store } = fakeStore();
    await recordSample(store, 'api', 100, at(0));
    await recordSample(store, 'api', 100, at(30));
    await recordSample(store, 'api', 900, at(60));
    expect(await medianLatency(store, 'api', at(60))).toBe(100);
  });

  it('leaves out a sample older than five minutes', async () => {
    const { store } = fakeStore();
    await recordSample(store, 'api', 9000, at(0));
    await recordSample(store, 'api', 100, at(200));
    await recordSample(store, 'api', 300, at(301));
    expect(await medianLatency(store, 'api', at(301))).toBe(200);
  });

  it('keeps each tile apart', async () => {
    const { store } = fakeStore();
    await recordSample(store, 'api', 100, at(0));
    await recordSample(store, 'maps', 4000, at(0));
    expect(await medianLatency(store, 'api', at(0))).toBe(100);
    expect(await medianLatency(store, 'maps', at(0))).toBe(4000);
  });

  it('keeps ten minutes under status:samples:{tile}, expiring in 600 s', async () => {
    const { sets, store, ttl } = fakeStore();
    await recordSample(store, 'email', 100, at(0));
    await recordSample(store, 'email', 200, at(599));
    await recordSample(store, 'email', 300, at(601));
    expect([
      ...(sets.get('status:samples:email') ?? new Map()).values(),
    ]).toEqual([at(599).getTime(), at(601).getTime()]);
    expect(ttl.get('status:samples:email')).toBe(600);
  });
});
