import { randomUUID } from 'node:crypto';

import { leiToBani, type StartingPricesInput } from '@motor-fix/contracts';

import { type PricesWorld, pricesWorld } from './garage-prices.testing';

const {
  history,
  job,
  nothingStored,
  prices,
  prisma,
  refused,
  rows,
  save,
  since,
  world,
} = pricesWorld();

const lei = leiToBani;
const labour = { fromBani: lei(180), toBani: lei(240) };

describe('GaragePricesService.saveStarting under hostile payloads', () => {
  it('refuses a job id that is not a uuid with a field error, not a database error', async () => {
    const w = await world();

    const errors = await refused(
      save(w, {
        jobs: [{ fromBani: lei(100), jobTypeId: 'not-a-uuid' }],
        labour,
      }),
    );

    expect(errors).toEqual([
      { code: 'unknown_job', field: 'jobs[0].jobTypeId' },
    ]);
    await nothingStored(w);
  });

  it('refuses an empty job id', async () => {
    const w = await world();

    const errors = await refused(
      save(w, { jobs: [{ fromBani: lei(100), jobTypeId: '' }], labour }),
    );

    expect(errors).toEqual([
      { code: 'unknown_job', field: 'jobs[0].jobTypeId' },
    ]);
    await nothingStored(w);
  });

  it('refuses a brand id that is not a uuid with a field error', async () => {
    const w = await world();

    const errors = await refused(
      save(w, {
        jobs: [
          { fromBani: lei(100), jobTypeId: w.brakes },
          { brandId: 'dacia', fromBani: lei(100), jobTypeId: w.brakes },
        ],
        labour,
      }),
    );

    expect(errors).toEqual([
      { code: 'unknown_brand', field: 'jobs[1].brandId' },
    ]);
    await nothingStored(w);
  });

  it('refuses the same job written in upper and lower case uuid as a duplicate', async () => {
    const w = await world();

    const errors = await refused(
      save(w, {
        jobs: [
          { fromBani: lei(100), jobTypeId: w.brakes },
          { fromBani: lei(100), jobTypeId: w.brakes.toUpperCase() },
        ],
        labour,
      }),
    );

    expect(errors).toContainEqual({
      code: 'duplicate',
      field: 'jobs[1].jobTypeId',
    });
    await nothingStored(w);
  });

  it('counts a null brand and a missing brand as the same default range', async () => {
    const w = await world();

    const errors = await refused(
      save(w, {
        jobs: [
          { brandId: null, fromBani: lei(100), jobTypeId: w.oil },
          { fromBani: lei(100), jobTypeId: w.oil },
        ],
        labour,
      }),
    );

    expect(errors).toEqual([{ code: 'duplicate', field: 'jobs[1].jobTypeId' }]);
    await nothingStored(w);
  });

  it('accepts a brand range listed before its default range in the payload', async () => {
    const w = await world();

    await save(w, {
      jobs: [
        { brandId: w.dacia, fromBani: lei(100), jobTypeId: w.oil },
        { fromBani: lei(90), jobTypeId: w.oil },
      ],
      labour,
    });

    expect((await rows(w)).map((r) => [r.brandId, r.position])).toEqual([
      [w.dacia, 0],
      [null, 1],
    ]);
  });

  it('refuses a brand range whose default range belongs to another brand only', async () => {
    const w = await world();

    const errors = await refused(
      save(w, {
        jobs: [
          { brandId: w.dacia, fromBani: lei(100), jobTypeId: w.oil },
          { brandId: w.ford, fromBani: lei(100), jobTypeId: w.oil },
        ],
        labour,
      }),
    );

    expect(errors.map((e) => e.code)).toEqual([
      'no_default_range',
      'no_default_range',
    ]);
    await nothingStored(w);
  });

  it('refuses a brand range when only the garage already stores the default range', async () => {
    const w = await world();
    await save(w, { jobs: [{ fromBani: lei(100), jobTypeId: w.oil }], labour });

    const errors = await refused(
      save(w, {
        jobs: [{ brandId: w.dacia, fromBani: lei(100), jobTypeId: w.oil }],
        labour,
      }),
    );

    expect(errors).toContainEqual({
      code: 'no_default_range',
      field: 'jobs[0].brandId',
    });
    expect(await rows(w)).toHaveLength(1);
  });

  it('stores nothing when only the last of five rows is bad', async () => {
    const w = await world();
    const extra = [await job('a'), await job('b')];

    const errors = await refused(
      save(w, {
        jobs: [
          { fromBani: lei(100), jobTypeId: w.oil },
          { fromBani: lei(100), jobTypeId: w.brakes },
          { fromBani: lei(100), jobTypeId: w.diagnosis },
          { fromBani: lei(100), jobTypeId: extra[0] },
          { fromBani: lei(100), jobTypeId: extra[1], toBani: lei(50) },
        ],
        labour,
      }),
    );

    expect(errors).toEqual([{ code: 'below_from', field: 'jobs[4].to' }]);
    await nothingStored(w);
  });

  it('reports the errors of every bad row in one refusal', async () => {
    const w = await world();

    const errors = await refused(
      save(w, {
        jobs: [
          { fromBani: 0, jobTypeId: w.oil },
          { fromBani: lei(100), jobTypeId: w.brakes },
          { durationMinutes: 10, fromBani: lei(100), jobTypeId: w.diagnosis },
        ],
        labour,
      }),
    );

    expect(errors).toEqual([
      { code: 'min', field: 'jobs[0].from' },
      { code: 'min', field: 'jobs[2].duration' },
    ]);
  });

  it('refuses a top of zero as below the starting price', async () => {
    const w = await world();

    const errors = await refused(
      save(w, {
        jobs: [{ fromBani: lei(100), jobTypeId: w.oil, toBani: 0 }],
        labour,
      }),
    );

    expect(errors).toEqual([{ code: 'below_from', field: 'jobs[0].to' }]);
  });

  it('refuses a duration of zero', async () => {
    const w = await world();

    const errors = await refused(
      save(w, {
        jobs: [{ durationMinutes: 0, fromBani: lei(100), jobTypeId: w.oil }],
        labour,
      }),
    );

    expect(errors).toEqual([{ code: 'min', field: 'jobs[0].duration' }]);
  });

  it('stores a null duration and a null top as empty', async () => {
    const w = await world();

    await save(w, {
      jobs: [
        {
          durationMinutes: null,
          fromBani: lei(100),
          jobTypeId: w.oil,
          toBani: null,
        },
      ],
      labour,
    });

    expect(await rows(w)).toEqual([
      expect.objectContaining({ durationMinutes: null, toBani: null }),
    ]);
  });

  it('accepts prices at exactly 100.000 lei', async () => {
    const w = await world();

    await save(w, {
      jobs: [{ fromBani: 10_000_000, jobTypeId: w.oil, toBani: 10_000_000 }],
      labour: { fromBani: 10_000_000, toBani: 10_000_000 },
    });

    expect(await rows(w)).toEqual([
      expect.objectContaining({ fromBani: 10_000_000, toBani: 10_000_000 }),
    ]);
  });

  it('refuses a labour range beyond the database integer with a field error', async () => {
    const w = await world();

    const errors = await refused(
      save(w, {
        jobs: [],
        labour: { fromBani: 3_000_000_000, toBani: 3_000_000_001 },
      }),
    );

    expect(errors).toContainEqual({ code: 'max', field: 'labour.from' });
    await nothingStored(w);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
  ])('asks for the labour top when it is %s', async (_, toBani) => {
    const w = await world();

    const errors = await refused(
      save(w, {
        jobs: [],
        labour: { fromBani: lei(180), toBani: toBani as unknown as number },
      }),
    );

    expect(errors).toEqual([{ code: 'required', field: 'labour.to' }]);
    await nothingStored(w);
  });

  it('asks for a labour top of zero as below the start, not as missing', async () => {
    const w = await world();

    const errors = await refused(
      save(w, { jobs: [], labour: { fromBani: lei(180), toBani: 0 } }),
    );

    expect(errors).toEqual([{ code: 'below_from', field: 'labour.to' }]);
  });

  it('refuses a labour range whose top is below its start', async () => {
    const w = await world();

    const errors = await refused(
      save(w, {
        jobs: [],
        labour: { fromBani: lei(240), toBani: lei(180) },
      }),
    );

    expect(errors).toEqual([{ code: 'below_from', field: 'labour.to' }]);
    await nothingStored(w);
  });

  it('warns on a wide labour range and stores it', async () => {
    const w = await world();

    const result = await save(w, {
      jobs: [],
      labour: { fromBani: lei(100), toBani: lei(400) },
    });

    expect(result.labour.warnings).toEqual([
      { code: 'wide_range', field: 'to' },
    ]);
    expect(
      await prisma.garage.findUniqueOrThrow({ where: { id: w.garage } }),
    ).toMatchObject({ labourFromBani: 10_000, labourToBani: 40_000 });
  });

  it('ignores a visible, position or updater a caller slips into a row', async () => {
    const w = await world();
    const stranger = randomUUID();
    const sneaky = {
      fromBani: lei(100),
      jobTypeId: w.oil,
      position: 99,
      updatedBy: stranger,
      visible: false,
    } as unknown as StartingPricesInput['jobs'][number];

    await save(w, { jobs: [sneaky], labour });

    expect(await rows(w)).toEqual([
      expect.objectContaining({
        position: 0,
        updatedBy: w.mihai,
        visible: true,
      }),
    ]);
  });

  it('saves three hundred jobs in order with one audit entry each plus the labour', async () => {
    const w = await world();
    const ids = await Promise.all(
      Array.from({ length: 300 }, (_, i) => job(`bulk-${i}`)),
    );

    const result = await save(w, {
      jobs: ids.map((jobTypeId) => ({ fromBani: lei(100), jobTypeId })),
      labour,
    });

    expect(result.jobs.map((j) => j.position)).toEqual(
      Array.from({ length: 300 }, (_, i) => i),
    );
    expect(result.jobs.map((j) => j.jobTypeId)).toEqual(ids);
    expect(await rows(w)).toHaveLength(300);
    expect(await history(w)).toHaveLength(302);
  });

  it('returns ids that match the stored rows and a warning only on the wide one', async () => {
    const w = await world();

    const result = await save(w, {
      jobs: [
        { fromBani: lei(200), jobTypeId: w.oil, toBani: lei(5_000) },
        { fromBani: lei(600), jobTypeId: w.brakes, toBani: lei(1_800) },
      ],
      labour,
    });

    const stored = await rows(w);
    expect(result.jobs.map((j) => j.id)).toEqual(stored.map((r) => r.id));
    expect(result.jobs.map((j) => j.warnings)).toEqual([
      [{ code: 'wide_range', field: 'to' }],
      [],
    ]);
  });

  it('refuses the same payload sent twice and leaves the first save and its history alone', async () => {
    const w = await world();
    const input: StartingPricesInput = {
      jobs: [{ fromBani: lei(100), jobTypeId: w.oil, toBani: lei(200) }],
      labour,
    };
    await save(w, input);
    const stored = await rows(w);
    const entries = await history(w);

    const errors = await refused(save(w, input));

    expect(errors).toContainEqual({
      code: 'duplicate',
      field: 'jobs[0].jobTypeId',
    });
    expect(await rows(w)).toEqual(stored);
    expect(await history(w)).toEqual(entries);
  });

  it('leaves another garage with the same job untouched', async () => {
    const w = await world();
    const other = await prisma.garage.create({
      data: { name: 'Other', slug: `other-${randomUUID()}` },
    });
    const input: StartingPricesInput = {
      jobs: [{ fromBani: lei(100), jobTypeId: w.oil }],
      labour,
    };
    await save(w, input);

    await prisma.$transaction((tx) =>
      prices.saveStarting(tx, other.id, w.mihai, input),
    );

    expect(
      await prisma.garagePrice.count({ where: { garageId: other.id } }),
    ).toBe(1);
    expect(await rows(w)).toHaveLength(1);
  });

  it('fails for an unknown garage and writes no entry', async () => {
    const w = await world();

    await expect(
      prisma.$transaction((tx) =>
        prices.saveStarting(tx, randomUUID(), w.mihai, {
          jobs: [{ fromBani: lei(100), jobTypeId: w.oil }],
          labour,
        }),
      ),
    ).rejects.toMatchObject({ code: 'P2025' });

    expect(await prisma.garagePrice.count()).toBe(0);
    expect(
      await prisma.activityLog.count({
        where: { at: { gte: since() }, subjectType: 'garage_price' },
      }),
    ).toBe(0);
  });

  it('stores one default range when two transactions save the same job together', async () => {
    const w = await world();
    const input: StartingPricesInput = {
      jobs: [{ fromBani: lei(100), jobTypeId: w.oil }],
      labour,
    };

    const outcomes = await Promise.allSettled([save(w, input), save(w, input)]);

    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(await rows(w)).toHaveLength(1);
    expect(
      (await history(w)).filter((e) => e.subjectType === 'garage_price'),
    ).toHaveLength(1);
  });
});

describe('the price table at the database', () => {
  const base = (w: PricesWorld) => ({
    fromBani: 10_000,
    garageId: w.garage,
    jobTypeId: w.oil,
    position: 0,
    updatedBy: w.mihai,
  });

  it('names the one-range index and declares NULLS NOT DISTINCT', async () => {
    const [index] = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'garage_price_one_range'`;

    expect(index.indexdef).toContain('NULLS NOT DISTINCT');
    expect(index.indexdef).toContain('UNIQUE');
  });

  it('allows a default range and one range per brand for the same job, but not a repeat of a brand', async () => {
    const w = await world();
    await prisma.garagePrice.create({ data: base(w) });
    await prisma.garagePrice.create({
      data: { ...base(w), brandId: w.dacia, position: 1 },
    });
    await prisma.garagePrice.create({
      data: { ...base(w), brandId: w.ford, position: 2 },
    });

    await expect(
      prisma.garagePrice.create({
        data: { ...base(w), brandId: w.dacia, position: 3 },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(await rows(w)).toHaveLength(3);
  });

  it('refuses a price for a job that does not exist', async () => {
    const w = await world();

    await expect(
      prisma.garagePrice.create({
        data: { ...base(w), jobTypeId: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('refuses a price for a brand that does not exist', async () => {
    const w = await world();

    await expect(
      prisma.garagePrice.create({
        data: { ...base(w), brandId: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('keeps a job that has prices from being deleted', async () => {
    const w = await world();
    await prisma.garagePrice.create({ data: base(w) });

    await expect(
      prisma.jobType.delete({ where: { id: w.oil } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('removes a garage prices with the garage', async () => {
    const w = await world();
    await prisma.garagePrice.create({ data: base(w) });

    await prisma.garage.delete({ where: { id: w.garage } });

    expect(await prisma.garagePrice.count()).toBe(0);
  });
});
