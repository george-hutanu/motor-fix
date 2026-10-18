import type { PublicGarageDto } from '@motor-fix/data-access';

import { estimateTotals } from './totals';

const row = (jobTypeId: string, fromBani: number, toBani: number) => ({
  fromBani,
  jobTypeId,
  nameEn: jobTypeId,
  nameRo: jobTypeId,
  toBani,
});

const PRICES: PublicGarageDto['prices'] = [
  row('j-diag', 15_000, 22_000),
  row('j-brakes', 110_000, 170_000),
  row('j-chain', 4_200_000, 6_800_000),
];

// @traces 311-FR-002
describe('the estimate totals', () => {
  it('adds the switched-on jobs in bani and rounds once to whole lei', () => {
    const totals = estimateTotals(PRICES, new Set(['j-brakes', 'j-diag']));

    expect(totals.fromLei).toBe(1250);
    expect(totals.toLei).toBe(1920);
  });

  it('keeps the list order and leaves out a job that is not on', () => {
    const totals = estimateTotals(PRICES, new Set(['j-chain', 'j-diag']));

    expect(totals.chosen.map((r) => r.jobTypeId)).toEqual([
      'j-diag',
      'j-chain',
    ]);
  });

  it('is nothing and zero with nothing on', () => {
    expect(estimateTotals(PRICES, new Set())).toEqual({
      chosen: [],
      fromLei: 0,
      toLei: 0,
    });
  });

  it('rounds the sum, not each row', () => {
    const totals = estimateTotals(
      [row('a', 14_950, 14_950), row('b', 14_950, 14_950)],
      new Set(['a', 'b']),
    );

    expect(totals.fromLei).toBe(299);
  });
});
