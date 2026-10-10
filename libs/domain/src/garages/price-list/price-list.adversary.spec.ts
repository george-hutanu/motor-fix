import { type PriceRow, priceListJobs } from './price-list';

type Status = PriceRow['jobType']['status'];

let next = 0;
const job = (
  status: Status = 'approved',
  rarActivity: string | null = null,
) => {
  next += 1;
  return {
    id: `adv-job-${next}`,
    nameEn: `Job ${next}`,
    nameRo: `Lucrare ț ${next}`,
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
  fromBani: 1000,
  id: `adv-row-${jobType.id}-${extra.brandId ?? 'default'}`,
  jobType,
  position: 0,
  toBani: 2000,
  visible: true,
  ...extra,
});

// @traces 357-public-price-jobs-FR-001
describe('priceListJobs edge inputs for the public rule', () => {
  it('treats an empty-string RAR activity on the job as no activity', () => {
    const [item] = priceListJobs([row(job('approved', ''))], ['B']);
    expect(item.public).toBe(true);
  });

  it('counts a top price of zero as set', () => {
    const [item] = priceListJobs([row(job(), { toBani: 0 })], []);
    expect(item.public).toBe(true);
    expect(item.toBani).toBe(0);
  });

  it('matches RAR activities case-sensitively and exactly', () => {
    const [item] = priceListJobs([row(job('approved', 'a'))], ['A']);
    expect(item).toMatchObject({ public: false, reason: 'not_authorised' });
  });

  it('does not trim whitespace when matching RAR activities', () => {
    const [item] = priceListJobs([row(job('approved', 'A'))], ['A ']);
    expect(item).toMatchObject({ public: false, reason: 'not_authorised' });
  });

  it('is public when the recorded activities include the job with others', () => {
    const [item] = priceListJobs([row(job('approved', 'Ț'))], ['x', 'Ț', 'y']);
    expect(item.public).toBe(true);
  });
});

// @traces 357-public-price-jobs-FR-002
describe('priceListJobs reason precedence over all combinations', () => {
  it('gives rejected over every other failing condition', () => {
    const [item] = priceListJobs(
      [row(job('rejected', 'A'), { toBani: null, visible: false })],
      ['B'],
    );
    expect(item.reason).toBe('rejected');
  });

  it('gives hidden_by_garage over no_top_price on a hidden incomplete default', () => {
    const [item] = priceListJobs(
      [row(job(), { toBani: null, visible: false })],
      [],
    );
    expect(item.reason).toBe('hidden_by_garage');
  });

  it('gives no_top_price over a visible brand row when no default row exists', () => {
    const [item] = priceListJobs(
      [row(job(), { brandId: 'b1', visible: false })],
      [],
    );
    expect(item).toMatchObject({ public: false, reason: 'no_top_price' });
  });

  it('gives not_authorised before no_top_price when there is no default row', () => {
    const [item] = priceListJobs(
      [row(job('approved', 'A'), { brandId: 'b1' })],
      ['B'],
    );
    expect(item.reason).toBe('not_authorised');
  });
});

// @traces 357-public-price-jobs-FR-003
describe('priceListJobs brand rows', () => {
  it('ignores any number of brand rows, hidden or incomplete, beside a complete default', () => {
    const j = job();
    const items = priceListJobs(
      [
        row(j, { brandId: 'b1', toBani: null, visible: false }),
        row(j, { brandId: 'b2', visible: false }),
        row(j),
      ],
      [],
    );
    expect(items).toHaveLength(1);
    expect(items[0].public).toBe(true);
  });

  it('never returns a brand range on the item', () => {
    const j = job();
    const [item] = priceListJobs(
      [
        row(j, { brandId: 'b1', durationMinutes: 999, fromBani: 7, toBani: 8 }),
        row(j, { durationMinutes: 30, fromBani: 100, toBani: 200 }),
      ],
      [],
    );
    expect(item).toEqual({
      durationMinutes: 30,
      fromBani: 100,
      jobTypeId: j.id,
      nameEn: j.nameEn,
      nameRo: j.nameRo,
      public: true,
      toBani: 200,
    });
  });

  it('returns no range keys at all for a job with only brand rows', () => {
    const j = job();
    const [item] = priceListJobs(
      [row(j, { brandId: 'b1', durationMinutes: 5, fromBani: 7, toBani: 8 })],
      [],
    );
    expect(Object.keys(item).sort()).toEqual(
      ['jobTypeId', 'nameEn', 'nameRo', 'public', 'reason'].sort(),
    );
  });
});

// @traces 357-public-price-jobs-FR-007
describe('priceListJobs item shape', () => {
  it('has no reason key on a public item', () => {
    const [item] = priceListJobs([row(job())], []);
    expect('reason' in item).toBe(false);
  });

  it('keeps a zero duration as set', () => {
    const [item] = priceListJobs([row(job(), { durationMinutes: 0 })], []);
    expect(item.durationMinutes).toBe(0);
  });

  it('omits duration and top keys when the default row leaves them null', () => {
    const [item] = priceListJobs([row(job())], []);
    const [bare] = priceListJobs(
      [row(job(), { durationMinutes: null, toBani: null })],
      [],
    );
    expect('durationMinutes' in bare).toBe(false);
    expect('toBani' in bare).toBe(false);
    expect(bare.fromBani).toBe(1000);
    expect(item.toBani).toBe(2000);
  });

  it('returns an empty list for no rows', () => {
    expect(priceListJobs([], ['A'])).toEqual([]);
  });

  it('returns one item for a single row', () => {
    expect(priceListJobs([row(job())], [])).toHaveLength(1);
  });
});

// @traces 357-public-price-jobs-FR-006
describe('priceListJobs ordering', () => {
  it('breaks equal positions by row id regardless of input order', () => {
    const a = job();
    const b = job();
    const c = job();
    const rows = [
      row(a, { id: 'r-3' }),
      row(b, { id: 'r-1' }),
      row(c, { id: 'r-2' }),
    ];
    const forward = priceListJobs(rows, []).map((i) => i.jobTypeId);
    const reversed = priceListJobs([...rows].reverse(), []).map(
      (i) => i.jobTypeId,
    );
    expect(forward).toEqual([b.id, c.id, a.id]);
    expect(reversed).toEqual(forward);
  });

  it('orders negative positions first', () => {
    const a = job();
    const b = job();
    const items = priceListJobs(
      [row(a, { position: 0 }), row(b, { position: -5 })],
      [],
    );
    expect(items.map((i) => i.jobTypeId)).toEqual([b.id, a.id]);
  });

  it('orders by the default row, not a lower brand row of the same job', () => {
    const a = job();
    const b = job();
    const items = priceListJobs(
      [
        row(a, { brandId: 'b1', position: 0 }),
        row(a, { position: 10 }),
        row(b, { position: 5 }),
      ],
      [],
    );
    expect(items.map((i) => i.jobTypeId)).toEqual([b.id, a.id]);
  });

  it('orders a job without a default row by its lowest brand position, whatever the input order', () => {
    const a = job();
    const b = job();
    const items = priceListJobs(
      [
        row(a, { brandId: 'b2', id: 'a2', position: 9 }),
        row(b, { position: 4 }),
        row(a, { brandId: 'b1', id: 'a1', position: 2 }),
      ],
      [],
    );
    expect(items.map((i) => i.jobTypeId)).toEqual([a.id, b.id]);
  });

  it('breaks a tie between brand-only positions by row id', () => {
    const a = job();
    const b = job();
    const items = priceListJobs(
      [row(a, { brandId: 'b1', id: 'z' }), row(b, { brandId: 'b1', id: 'm' })],
      [],
    );
    expect(items.map((i) => i.jobTypeId)).toEqual([b.id, a.id]);
  });
});

// @traces 357-public-price-jobs-FR-004
describe('priceListJobs purity', () => {
  it('does not mutate its inputs', () => {
    const j = job();
    const rows = [row(j, { brandId: 'b1', position: 3 }), row(j)];
    const acts = ['A'];
    const before = JSON.stringify([rows, acts]);
    priceListJobs(rows, acts);
    expect(JSON.stringify([rows, acts])).toBe(before);
  });

  it('gives the same answer twice and for shuffled input', () => {
    const rows = [job(), job('pending'), job('rejected')].map((j, i) =>
      row(j, { position: i }),
    );
    const first = priceListJobs(rows, []);
    expect(priceListJobs(rows, [])).toEqual(first);
    expect(priceListJobs([...rows].reverse(), [])).toEqual(first);
  });

  it('handles ten thousand jobs in order', () => {
    const rows = Array.from({ length: 10_000 }, (_, i) =>
      row(job(), {
        id: `big-${String(i).padStart(5, '0')}`,
        position: 10_000 - i,
      }),
    );
    const items = priceListJobs(rows, []);
    expect(items).toHaveLength(10_000);
    expect(items[0].jobTypeId).toBe(rows[9_999].jobType.id);
    expect(items[9_999].jobTypeId).toBe(rows[0].jobType.id);
  });

  it('handles ten thousand brand rows of one job as one item', () => {
    const j = job();
    const rows = Array.from({ length: 10_000 }, (_, i) =>
      row(j, { brandId: `b${i}`, id: `r${i}` }),
    );
    expect(priceListJobs(rows, [])).toHaveLength(1);
  });
});
