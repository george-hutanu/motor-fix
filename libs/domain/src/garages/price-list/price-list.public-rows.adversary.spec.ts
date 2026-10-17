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
    id: `pub-job-${next}`,
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
  brand: null,
  brandId: null,
  durationMinutes: null,
  fromBani: 1000,
  id: `pub-row-${jobType.id}-${extra.brandId ?? 'default'}`,
  jobType,
  position: 0,
  toBani: 2000,
  visible: true,
  ...extra,
});

const BMW = 'brand-bmw';
const ranges = (rows: ReturnType<typeof publicPriceRows>) =>
  rows.map((r) => [r.jobTypeId, r.fromBani, r.toBani]);

// @traces 355-price-list-ranges-FR-001
// @traces 355-price-list-ranges-FR-002
describe('publicPriceRows with a brand range', () => {
  it('returns an empty list for no rows', () => {
    expect(publicRows([], [])).toEqual([]);
    expect(publicRows([], [], { id: BMW, ticks: ['x'] })).toEqual([]);
  });

  it('uses a complete brand range even when the brand row is hidden', () => {
    const j = job();
    const rows = [
      row(j),
      row(j, { brandId: BMW, fromBani: 5000, toBani: 9000, visible: false }),
    ];

    expect(ranges(publicRows(rows, [], { id: BMW, ticks: [] }))).toEqual([
      [j.id, 5000, 9000],
    ]);
  });

  it('uses a brand range whose ends are zero', () => {
    const j = job();
    const rows = [row(j), row(j, { brandId: BMW, fromBani: 0, toBani: 0 })];

    expect(ranges(publicRows(rows, [], { id: BMW, ticks: [] }))).toEqual([
      [j.id, 0, 0],
    ]);
  });

  it('keeps the default range when the brand row has no top', () => {
    const j = job();
    const rows = [
      row(j),
      row(j, { brandId: BMW, fromBani: 5000, toBani: null }),
    ];

    expect(ranges(publicRows(rows, [], { id: BMW, ticks: [] }))).toEqual([
      [j.id, 1000, 2000],
    ]);
  });

  it('ignores the range of another brand', () => {
    const j = job();
    const rows = [
      row(j),
      row(j, { brandId: 'brand-audi', fromBani: 1, toBani: 2 }),
    ];

    expect(ranges(publicRows(rows, [], { id: BMW, ticks: [] }))).toEqual([
      [j.id, 1000, 2000],
    ]);
  });

  it('never lists a job that has only a brand row', () => {
    const j = job();
    const rows = [row(j, { brandId: BMW, fromBani: 5000, toBani: 9000 })];

    expect(publicRows(rows, [], { id: BMW, ticks: [j.id] })).toEqual([]);
  });

  it('never lists a job the rule hides, whatever the brand range or tick', () => {
    const hiddenByGarage = job();
    const noTop = job();
    const pending = job('pending');
    const rejected = job('rejected');
    const unauthorised = job('approved', 'Z9');
    const all = [hiddenByGarage, noTop, pending, rejected, unauthorised];
    const rows = [
      row(hiddenByGarage, { visible: false }),
      row(noTop, { toBani: null }),
      row(pending),
      row(rejected),
      row(unauthorised),
      ...all.map((j) => row(j, { brandId: BMW, fromBani: 1, toBani: 2 })),
    ];

    expect(
      publicRows(rows, ['B'], { id: BMW, ticks: all.map((j) => j.id) }),
    ).toEqual([]);
  });

  it('takes the duration from the default row, not the brand row', () => {
    const j = job();
    const rows = [
      row(j, { durationMinutes: 120 }),
      row(j, { brandId: BMW, durationMinutes: 999, fromBani: 5, toBani: 6 }),
    ];

    const [only] = publicRows(rows, [], { id: BMW, ticks: [] });

    expect(only.durationMinutes).toBe(120);
  });

  it('omits the duration key when the default row has none', () => {
    const [only] = publicRows([row(job())], []);

    expect(Object.keys(only).sort()).toEqual([
      'fromBani',
      'jobTypeId',
      'nameEn',
      'nameRo',
      'toBani',
    ]);
  });
});

// @traces 355-price-list-ranges-FR-003
// @traces 355-price-list-ranges-FR-004
describe('publicPriceRows with brand ticks', () => {
  it('lists only ticked jobs once any tick exists', () => {
    const a = job();
    const b = job();
    const rows = [row(a, { position: 0 }), row(b, { position: 1 })];

    expect(
      publicRows(rows, [], { id: BMW, ticks: [b.id] }).map((r) => r.jobTypeId),
    ).toEqual([b.id]);
  });

  it('lists nothing when every tick names a job that is not public', () => {
    const a = job();

    expect(
      publicRows([row(a)], [], { id: BMW, ticks: ['someone-else'] }),
    ).toEqual([]);
  });

  it('lists every public job for an empty tick list and for no brand', () => {
    const a = job();
    const b = job();
    const rows = [row(a, { position: 0 }), row(b, { position: 1 })];

    expect(publicRows(rows, [], { id: BMW, ticks: [] })).toHaveLength(2);
    expect(publicRows(rows, [])).toHaveLength(2);
  });

  it('keeps the order of the default rows however the brand rows are placed', () => {
    const a = job();
    const b = job();
    const rows = [
      row(b, { position: 5 }),
      row(a, { position: 1 }),
      row(b, { brandId: BMW, fromBani: 1, position: 0, toBani: 2 }),
    ];

    expect(
      publicRows(rows, [], { id: BMW, ticks: [] }).map((r) => r.jobTypeId),
    ).toEqual([a.id, b.id]);
  });
});

// @traces 355-price-list-ranges-FR-005
describe('publicPriceRows purity', () => {
  it('answers the same twice and leaves frozen input untouched', () => {
    const j = job();
    const rows = Object.freeze([
      Object.freeze(row(j, { durationMinutes: 30 })),
      Object.freeze(row(j, { brandId: BMW, fromBani: 7, toBani: 8 })),
    ]);
    const brand = Object.freeze({ id: BMW, ticks: Object.freeze([j.id]) });

    const first = publicRows(rows, [], brand);
    const second = publicRows(rows, [], brand);

    expect(second).toEqual(first);
    expect(first).toHaveLength(1);
  });

  it('handles ten thousand jobs in list order', () => {
    const rows = Array.from({ length: 10_000 }, (_, i) =>
      row(job(), { position: 10_000 - i }),
    );

    const out = publicRows(rows, []);

    expect(out).toHaveLength(10_000);
    expect(out[0].jobTypeId).toBe(rows[9_999].jobType.id);
  });
});
