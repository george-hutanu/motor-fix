import { coversJob } from '@motor-fix/contracts';

import { type PriceRow, priceListJobs, publicPriceRows } from './price-list';

// The profile read's two steps, as public-garages.ts runs them.
const publicRows = (
  rows: readonly PriceRow[],
  rarActivities: readonly string[],
  brand?: Parameters<typeof publicPriceRows>[2],
) => publicPriceRows(rows, priceListJobs(rows, rarActivities), brand);

type Status = PriceRow['jobType']['status'];

let next = 0;
const job = (
  status: Status = 'approved',
  rarActivity: string | null = null,
) => {
  next += 1;
  return {
    id: `job-${next}`,
    nameEn: `Job ${next}`,
    nameRo: `Lucrare ${next}`,
    rarActivity,
    status,
  };
};

const row = (
  jobType: PriceRow['jobType'],
  extra: Partial<Omit<PriceRow, 'jobType'>> = {},
): PriceRow => ({
  brandId: null,
  durationMinutes: null,
  fromBani: 35_000,
  id: `row-${jobType.id}-${extra.brandId ?? 'default'}`,
  jobType,
  position: 0,
  toBani: 48_000,
  visible: true,
  ...extra,
});

const stateOf = (rows: PriceRow[], rarActivities: string[] = []) => {
  const [item] = priceListJobs(rows, rarActivities);
  return item?.public ? 'public' : item?.reason;
};

// @traces 357-public-price-jobs-FR-001
// @traces 357-public-price-jobs-FR-002
// @traces 357-public-price-jobs-FR-003
// @traces 357-public-price-jobs-FR-008
describe('whether drivers see a job, and why not', () => {
  const hidden = { visible: false };
  const fromOnly = { toBani: null };
  const brand = { brandId: 'bmw' };

  it.each<[string, () => PriceRow[], string[], string]>([
    ['a complete, visible, approved job', () => [row(job())], [], 'public'],
    [
      'a job with an activity while the garage has none recorded',
      () => [row(job('approved', 'A'))],
      [],
      'public',
    ],
    [
      'a job whose activity the garage holds',
      () => [row(job('approved', 'A'))],
      ['A', 'B'],
      'public',
    ],
    [
      'a job whose activity the garage lacks',
      () => [row(job('approved', 'A'))],
      ['B'],
      'not_authorised',
    ],
    [
      'a job with no activity at a garage with some recorded',
      () => [row(job())],
      ['B'],
      'public',
    ],
    [
      'a job the garage hid',
      () => [row(job(), hidden)],
      [],
      'hidden_by_garage',
    ],
    [
      'a job with no top price',
      () => [row(job(), fromOnly)],
      [],
      'no_top_price',
    ],
    [
      'a default range with no top beside a complete brand range',
      () => {
        const j = job();
        return [row(j, fromOnly), row(j, { ...brand, position: 1 })];
      },
      [],
      'no_top_price',
    ],
    [
      'a complete default range beside a hidden, unfinished brand range',
      () => {
        const j = job();
        return [row(j), row(j, { ...brand, ...hidden, ...fromOnly })];
      },
      [],
      'public',
    ],
    [
      'a job with only a brand range',
      () => [row(job(), brand)],
      [],
      'no_top_price',
    ],
    [
      'a job waiting for approval',
      () => [row(job('pending'))],
      [],
      'awaiting_approval',
    ],
    [
      'a rejected job that is also unauthorised, hidden and without a top',
      () => [row(job('rejected', 'A'), { ...hidden, ...fromOnly })],
      ['B'],
      'rejected',
    ],
    [
      'a pending job that is also unauthorised, hidden and without a top',
      () => [row(job('pending', 'A'), { ...hidden, ...fromOnly })],
      ['B'],
      'awaiting_approval',
    ],
    [
      'an unauthorised job that is also hidden and without a top',
      () => [row(job('approved', 'A'), { ...hidden, ...fromOnly })],
      ['B'],
      'not_authorised',
    ],
    [
      'a hidden job without a top',
      () => [row(job(), { ...hidden, ...fromOnly })],
      [],
      'hidden_by_garage',
    ],
  ])('%s is %s', (_case, rows, rarActivities, expected) => {
    expect(stateOf(rows(), rarActivities)).toBe(expected);
  });

  it('gives a public job no reason', () => {
    const [item] = priceListJobs([row(job())], []);

    expect(item).not.toHaveProperty('reason');
  });
});

// @traces 357-public-price-jobs-FR-004
// @traces 357-public-price-jobs-FR-007
describe('the price list items', () => {
  it('is empty without a price row', () => {
    expect(priceListJobs([], [])).toEqual([]);
  });

  it('gives one item per job from its default range', () => {
    const j = job();

    expect(
      priceListJobs(
        [
          row(j, { brandId: 'bmw', fromBani: 50_000, toBani: 90_000 }),
          row(j, { durationMinutes: 90, toBani: null }),
        ],
        [],
      ),
    ).toEqual([
      {
        durationMinutes: 90,
        fromBani: 35_000,
        jobTypeId: j.id,
        nameEn: j.nameEn,
        nameRo: j.nameRo,
        public: false,
        reason: 'no_top_price',
      },
    ]);
  });

  it('carries no range for a job with only a brand range', () => {
    const j = job();

    expect(priceListJobs([row(j, { brandId: 'bmw' })], [])).toEqual([
      {
        jobTypeId: j.id,
        nameEn: j.nameEn,
        nameRo: j.nameRo,
        public: false,
        reason: 'no_top_price',
      },
    ]);
  });

  it('orders jobs by the default row, else the lowest brand row, then the row id', () => {
    const second = job();
    const first = job();
    const brandOnly = job();
    const tieA = job();
    const tieB = job();

    const ids = priceListJobs(
      [
        row(second, { position: 2 }),
        row(second, { brandId: 'bmw', position: 0 }),
        row(first, { position: 1 }),
        row(brandOnly, { brandId: 'bmw', position: 5 }),
        row(brandOnly, { brandId: 'audi', position: 3 }),
        row(tieB, { id: 'row-b', position: 4 }),
        row(tieA, { id: 'row-a', position: 4 }),
      ],
      [],
    ).map((item) => item.jobTypeId);

    expect(ids).toEqual([first.id, second.id, brandOnly.id, tieA.id, tieB.id]);
  });
});

// @traces 355-price-list-ranges-FR-001
// @traces 355-price-list-ranges-FR-004
describe('the public price rows of a profile read without a brand', () => {
  it('is empty without a price row', () => {
    expect(publicRows([], [])).toEqual([]);
  });

  it('gives each public job its names, duration and default range', () => {
    const j = job();

    expect(
      publicRows(
        [row(j, { durationMinutes: 120, fromBani: 89_000, toBani: 140_000 })],
        [],
      ),
    ).toEqual([
      {
        durationMinutes: 120,
        fromBani: 89_000,
        jobTypeId: j.id,
        nameEn: j.nameEn,
        nameRo: j.nameRo,
        toBani: 140_000,
      },
    ]);
  });

  it('leaves the duration out when the default row has none', () => {
    const [item] = publicRows([row(job())], []);

    expect(item).not.toHaveProperty('durationMinutes');
  });

  it('lists jobs in the order of their default rows, whatever the brand rows say', () => {
    const second = job();
    const first = job();
    const third = job();

    const ids = publicRows(
      [
        row(second, { position: 2 }),
        row(second, { brandId: 'bmw', position: 0 }),
        row(third, { position: 3 }),
        row(first, { position: 1 }),
      ],
      [],
      { id: 'bmw', ticks: [] },
    ).map((item) => item.jobTypeId);

    expect(ids).toEqual([first.id, second.id, third.id]);
  });

  it('never carries a hidden job, the way the price list rule hides it', () => {
    const shown = job();
    const rows = [
      row(shown),
      row(job('approved', 'A')),
      row(job(), { visible: false }),
      row(job(), { toBani: null }),
      row(job('pending')),
      row(job('rejected')),
      row(job(), { brandId: 'bmw' }),
    ];

    expect(publicRows(rows, ['B']).map((item) => item.jobTypeId)).toEqual([
      shown.id,
    ]);
  });
});

// @traces 355-price-list-ranges-FR-002
// @traces 355-price-list-ranges-FR-003
describe('the public price rows of a profile read with a brand', () => {
  const ranges = (
    rows: PriceRow[],
    brand?: { id: string; refused?: boolean; ticks: string[] },
  ) =>
    publicRows(rows, [], brand).map(({ fromBani, toBani }) => [
      fromBani,
      toBani,
    ]);

  it("shows the brand's range when it has both ends", () => {
    const j = job();
    const rows = [
      row(j, { fromBani: 89_000, toBani: 140_000 }),
      row(j, { brandId: 'bmw', fromBani: 110_000, toBani: 170_000 }),
    ];

    expect(ranges(rows, { id: 'bmw', ticks: [] })).toEqual([
      [110_000, 170_000],
    ]);
  });

  it('keeps the default range when the brand row has no top', () => {
    const j = job();
    const rows = [
      row(j, { fromBani: 89_000, toBani: 140_000 }),
      row(j, { brandId: 'bmw', fromBani: 110_000, toBani: null }),
    ];

    expect(ranges(rows, { id: 'bmw', ticks: [] })).toEqual([[89_000, 140_000]]);
  });

  it("ignores another brand's range, and every brand range without a brand", () => {
    const j = job();
    const rows = [
      row(j, { fromBani: 89_000, toBani: 140_000 }),
      row(j, { brandId: 'bmw', fromBani: 110_000, toBani: 170_000 }),
    ];

    expect(ranges(rows, { id: 'audi', ticks: [] })).toEqual([
      [89_000, 140_000],
    ]);
    expect(ranges(rows)).toEqual([[89_000, 140_000]]);
  });

  it("uses a brand's range even when its own row is marked hidden", () => {
    const j = job();
    const rows = [
      row(j),
      row(j, {
        brandId: 'bmw',
        fromBani: 110_000,
        toBani: 170_000,
        visible: false,
      }),
    ];

    expect(ranges(rows, { id: 'bmw', ticks: [] })).toEqual([
      [110_000, 170_000],
    ]);
  });

  it('keeps the default range for a brand the garage does not take', () => {
    const j = job();
    const rows = [
      row(j),
      row(j, { brandId: 'bmw', fromBani: 110_000, toBani: 170_000 }),
    ];

    expect(ranges(rows, { id: 'bmw', refused: true, ticks: [] })).toEqual([
      [35_000, 48_000],
    ]);
  });

  it('keeps the default duration beside a brand range', () => {
    const j = job();
    const [item] = publicRows(
      [
        row(j, { durationMinutes: 120 }),
        row(j, { brandId: 'bmw', durationMinutes: 30, toBani: 90_000 }),
      ],
      [],
      { id: 'bmw', ticks: [] },
    );

    expect(item?.durationMinutes).toBe(120);
  });

  it('lists only the ticked jobs when the brand has ticks', () => {
    const brakes = job();
    const chain = job();
    const rows = [row(brakes), row(chain, { position: 1 })];

    expect(
      publicRows(rows, [], { id: 'bmw', ticks: [brakes.id] }).map(
        (item) => item.jobTypeId,
      ),
    ).toEqual([brakes.id]);
  });

  it('lists every public job when the brand has no tick', () => {
    const brakes = job();
    const chain = job();
    const rows = [row(brakes), row(chain, { position: 1 })];

    expect(
      publicRows(rows, [], { id: 'audi', ticks: [] }).map(
        (item) => item.jobTypeId,
      ),
    ).toEqual([brakes.id, chain.id]);
  });

  it.each<[string, Partial<Omit<PriceRow, 'jobType'>>, Status, string | null]>([
    ['hidden by the garage', { visible: false }, 'approved', null],
    ['without a top price', { toBani: null }, 'approved', null],
    ['waiting for approval', {}, 'pending', null],
    ['rejected', {}, 'rejected', null],
    ['not authorised', {}, 'approved', 'A'],
  ])(
    'never lists a job %s, ticked and with a complete brand range',
    (_case, extra, status, activity) => {
      const j = job(status, activity);
      const rows = [
        row(j, extra),
        row(j, { brandId: 'bmw', fromBani: 110_000, toBani: 170_000 }),
      ];

      expect(publicRows(rows, ['B'], { id: 'bmw', ticks: [j.id] })).toEqual([]);
    },
  );
});

// @traces 204-FR-004
describe('a job not authorised is a job the activities do not cover', () => {
  const activities = [null, 'brakes', 'paintwork'];
  const lists = [
    [],
    ['brakes'],
    ['mechanics', 'paintwork'],
    ['brakes', 'paintwork'],
  ];

  it.each(
    activities.flatMap((activity) =>
      lists.map((list) => [activity, list] as const),
    ),
  )('agrees with coversJob for %s against %j', (activity, list) => {
    const notAuthorised =
      stateOf([row(job('approved', activity))], [...list]) === 'not_authorised';
    expect(notAuthorised).toBe(!coversJob(activity, list));
  });
});
