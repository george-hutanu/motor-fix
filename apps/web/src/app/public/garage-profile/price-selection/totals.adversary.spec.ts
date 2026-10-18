import type { PublicGarageDto } from '@motor-fix/data-access';

import { estimateTotals } from './totals';

const row = (jobTypeId: string, fromBani: number, toBani: number) => ({
  fromBani,
  jobTypeId,
  nameEn: jobTypeId,
  nameRo: jobTypeId,
  toBani,
});

// @traces 311-FR-002
describe('the estimate totals under odd input', () => {
  it('is zero for an empty price list', () => {
    expect(estimateTotals([], new Set(['x']))).toEqual({
      chosen: [],
      fromLei: 0,
      toLei: 0,
    });
  });

  it('ignores a switched-on id the list does not hold', () => {
    const totals = estimateTotals(
      [row('a', 10_000, 20_000)],
      new Set(['a', 'ghost']),
    );

    expect(totals.chosen).toHaveLength(1);
    expect(totals.fromLei).toBe(100);
    expect(totals.toLei).toBe(200);
  });

  it('rounds a half leu up', () => {
    const totals = estimateTotals([row('a', 50, 150)], new Set(['a']));

    expect(totals.fromLei).toBe(1);
    expect(totals.toLei).toBe(2);
  });

  it('rounds just under a half leu down', () => {
    expect(estimateTotals([row('a', 49, 49)], new Set(['a'])).fromLei).toBe(0);
  });

  it('does not change its inputs', () => {
    const prices: PublicGarageDto['prices'] = [
      row('a', 100, 200),
      row('b', 300, 400),
    ];
    const on = new Set(['b']);
    estimateTotals(prices, on);

    expect(prices.map((p) => p.jobTypeId)).toEqual(['a', 'b']);
    expect([...on]).toEqual(['b']);
  });

  it('sums ten thousand rows exactly', () => {
    const prices = Array.from({ length: 10_000 }, (_, i) =>
      row(`j${i}`, 100, 300),
    );
    const on = new Set(prices.map((p) => p.jobTypeId));
    const totals = estimateTotals(prices, on);

    expect(totals.chosen).toHaveLength(10_000);
    expect(totals.fromLei).toBe(10_000);
    expect(totals.toLei).toBe(30_000);
  });

  it('keeps a sum past 2^31 bani exact', () => {
    const totals = estimateTotals(
      [
        row('a', 2_000_000_000, 2_000_000_000),
        row('b', 2_000_000_000, 2_000_000_000),
      ],
      new Set(['a', 'b']),
    );

    expect(totals.fromLei).toBe(40_000_000);
  });

  it('is the same on a second call', () => {
    const prices = [row('a', 150, 250), row('b', 350, 450)];
    const on = new Set(['a', 'b']);

    expect(estimateTotals(prices, on)).toEqual(estimateTotals(prices, on));
  });
});
