import { type PriceRow, priceListJobs, publicPriceRows } from './price-list';

const job = {
  id: 'j1',
  nameEn: 'Brakes',
  nameRo: 'Frane',
  rarActivity: null,
  status: 'approved' as const,
};

const row = (extra: Partial<PriceRow> = {}): PriceRow => ({
  brand: null,
  brandId: null,
  durationMinutes: null,
  fromBani: 1000,
  id: `r-${extra.brandId ?? 'default'}`,
  jobType: job,
  position: 0,
  toBani: 2000,
  updatedAt: new Date(0),
  visible: true,
  ...extra,
});

const brandRow = (
  id: string,
  name: string,
  popularity: number | null,
  extra: Partial<PriceRow> = {},
) => row({ brand: { name, popularity }, brandId: id, ...extra });

// @traces 386-FR-011
describe('brandRanges on the owner list', () => {
  it('ranks popularity zero before every other rank and the unranked last', () => {
    const [item] = priceListJobs(
      [
        row(),
        brandRow('a', 'Zeta', null),
        brandRow('b', 'Beta', 5),
        brandRow('c', 'Omega', 0),
      ],
      [],
    );

    expect(item.brandRanges.map((r) => r.brandId)).toEqual(['c', 'b', 'a']);
  });

  it('breaks equal ranks by name regardless of input order', () => {
    const rows = [brandRow('a', 'Skoda', 3), brandRow('b', 'Audi', 3), row()];

    const forward = priceListJobs(rows, [])[0].brandRanges.map((r) => r.name);
    const reversed = priceListJobs([...rows].reverse(), [])[0].brandRanges.map(
      (r) => r.name,
    );

    expect(forward).toEqual(['Audi', 'Skoda']);
    expect(reversed).toEqual(forward);
  });

  it('lists a brand row hidden by the garage and omits toBani on one with no top', () => {
    const [item] = priceListJobs(
      [row(), brandRow('a', 'Audi', 1, { toBani: null, visible: false })],
      [],
    );

    expect(item.brandRanges).toEqual([
      { brandId: 'a', fromBani: 1000, name: 'Audi' },
    ]);
    expect('toBani' in item.brandRanges[0]).toBe(false);
  });

  it('keeps a zero top price on a brand row', () => {
    const [item] = priceListJobs(
      [row(), brandRow('a', 'Audi', 1, { toBani: 0 })],
      [],
    );

    expect(item.brandRanges[0]).toMatchObject({ toBani: 0 });
  });

  it('answers an empty brandRanges list for no rows and for a default-only job', () => {
    expect(priceListJobs([], [])).toEqual([]);
    expect(priceListJobs([row()], [])[0].brandRanges).toEqual([]);
  });

  it('keeps brand rows of a job the rule hides, still listed for the owner', () => {
    const hidden = { ...job, status: 'rejected' as const };
    const [item] = priceListJobs(
      [row({ jobType: hidden }), brandRow('a', 'Audi', 1, { jobType: hidden })],
      [],
    );

    expect(item.public).toBe(false);
    expect(item.brandRanges).toHaveLength(1);
  });
});

// @traces 386-FR-002
describe('publicPriceRows brand choice at the edges', () => {
  it('uses the default for a refused brand even when ticks name the job', () => {
    const rows = [row(), brandRow('a', 'Audi', 1, { fromBani: 5, toBani: 9 })];
    const jobs = priceListJobs(rows, []);

    const shown = publicPriceRows(rows, jobs, {
      id: 'a',
      refused: true,
      ticks: ['j1'],
    });

    expect(shown).toEqual([
      expect.objectContaining({ fromBani: 1000, toBani: 2000 }),
    ]);
  });

  it('lists nothing for a brand whose ticks name only an unknown job', () => {
    const rows = [row(), brandRow('a', 'Audi', 1)];

    expect(
      publicPriceRows(rows, priceListJobs(rows, []), {
        id: 'a',
        ticks: ['ghost'],
      }),
    ).toEqual([]);
  });

  it('does not take a range from a brand row whose top is missing even if the low price is lower', () => {
    const rows = [
      row(),
      brandRow('a', 'Audi', 1, { fromBani: 1, toBani: null }),
    ];

    const shown = publicPriceRows(rows, priceListJobs(rows, []), {
      id: 'a',
      ticks: [],
    });

    expect(shown).toEqual([
      expect.objectContaining({ fromBani: 1000, toBani: 2000 }),
    ]);
  });

  it('does not mix the brand low price with the default top price', () => {
    const rows = [
      row(),
      brandRow('a', 'Audi', 1, { fromBani: 1500, toBani: 1800 }),
    ];

    const [shown] = publicPriceRows(rows, priceListJobs(rows, []), {
      id: 'a',
      ticks: [],
    });

    expect([shown.fromBani, shown.toBani]).toEqual([1500, 1800]);
  });
});
