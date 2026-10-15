import { cacheKey, lifetimes } from './cache.service';

// @traces 1182-FR-001 1182-FR-002 1182-FR-004
describe('cache lifetimes', () => {
  it.each([
    [0, 540_000],
    [0.5, 600_000],
    [0.999_999, 659_999],
  ])('jitters the soft lifetime within 0.9 to 1.1 (draw %d)', (draw, soft) => {
    const { hardMs, softMs } = lifetimes(600, false, () => draw);

    expect(softMs).toBe(soft);
    expect(hardMs).toBe(soft + 600_000);
  });

  it('keeps a not-found or empty answer for its jittered 60 seconds, never stale', () => {
    expect(lifetimes(600, true, () => 0)).toEqual({
      hardMs: 54_000,
      softMs: 54_000,
    });
    expect(lifetimes(60, true, () => 0.999_999)).toEqual({
      hardMs: 65_999,
      softMs: 65_999,
    });
  });

  it('spreads entries written together', () => {
    const softs = new Set(
      Array.from({ length: 50 }, () => lifetimes(60, false).softMs),
    );

    expect(softs.size).toBeGreaterThan(1);
    for (const soft of softs) {
      expect(soft).toBeGreaterThanOrEqual(54_000);
      expect(soft).toBeLessThan(66_000);
    }
  });
});

describe('cache keys', () => {
  it('names the version and the read kind first', () => {
    expect(cacheKey('profile', 'service-auto', '-')).toBe(
      'v1:profile:service-auto:-',
    );
    expect(cacheKey('popular-brands', '8')).toBe('v1:popular-brands:8');
  });
});
