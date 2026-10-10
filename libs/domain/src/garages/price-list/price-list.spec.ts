import { type PriceRow, priceListJobs } from './price-list';

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
