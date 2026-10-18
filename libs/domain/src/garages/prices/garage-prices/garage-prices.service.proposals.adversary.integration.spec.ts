import { leiToBani, type StartingPricesInput } from '@motor-fix/contracts';
import { HttpException } from '@nestjs/common';

import { pricesWorld, refused } from './garage-prices.testing';

const { history, nothingStored, prices, prisma, rows, save, world } =
  pricesWorld();

const lei = leiToBani;
const labour = { fromBani: lei(180), toBani: lei(240) };

const proposed = (garage: string) =>
  prisma.jobType.findMany({
    orderBy: { createdAt: 'asc' },
    where: { proposedByGarageId: garage },
  });

const events = (garage: string) =>
  prisma.outboxEvent.findMany({
    where: {
      kind: 'catalogue_job.proposed',
      payload: { equals: garage, path: ['garageId'] },
    },
  });

async function outcome(run: Promise<unknown>) {
  return run.then(
    () => 'saved',
    (e: unknown) =>
      e instanceof HttpException ? `http ${e.getStatus()}` : 'raw error',
  );
}

describe('GaragePricesService.saveStarting proposing jobs', () => {
  it('gives names that make one key different keys, never a server error', async () => {
    const w = await world();

    await save(w, {
      jobs: [
        { fromBani: lei(100), name: 'Spălare-motor' },
        { fromBani: lei(100), name: 'Spălare motor' },
        { fromBani: lei(100), name: 'SPĂLARE  MOTOR' },
      ],
      labour,
    });

    const keys = (await proposed(w.garage)).map((j) => j.key);
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
  });

  it('gives a name that makes an existing catalogue key a new key', async () => {
    const w = await world();

    await save(w, {
      jobs: [{ fromBani: lei(100), name: 'Front Brakes' }],
      labour,
    });

    const [created] = await proposed(w.garage);
    expect(created.key).not.toBe('front-brakes');
    expect(created.key).toMatch(/^front-brakes/);
  });

  it.each([
    ['!!!', '???'],
    ['日本語', '中文字'],
    ['😀😀', '🔧🔧'],
  ])(
    'proposes %s and %s, whose keys would both be empty, with distinct non-empty keys',
    async (a, b) => {
      const w = await world();

      await save(w, {
        jobs: [
          { fromBani: lei(100), name: a },
          { fromBani: lei(100), name: b },
        ],
        labour,
      });

      const keys = (await proposed(w.garage)).map((j) => j.key);
      expect(keys).toHaveLength(2);
      expect(keys.every((key) => key.length > 0)).toBe(true);
      expect(new Set(keys).size).toBe(2);
    },
  );

  it('stores the trimmed name in both languages as a pending job of the garage', async () => {
    const w = await world();

    await save(w, {
      jobs: [{ fromBani: lei(100), name: '   Schimb ambreiaj   ' }],
      labour,
    });

    expect(await proposed(w.garage)).toEqual([
      expect.objectContaining({
        nameEn: 'Schimb ambreiaj',
        nameRo: 'Schimb ambreiaj',
        proposedByGarageId: w.garage,
        status: 'pending',
      }),
    ]);
  });

  it.each([
    ['two characters', 'ab', true],
    ['two characters padded', '  ab  ', true],
    ['eighty characters', 'n'.repeat(80), true],
    ['eighty characters padded', `  ${'n'.repeat(80)}  `, true],
    ['one character', 'a', false],
    ['eighty-one characters', 'n'.repeat(81), false],
    ['a tab and a newline', '\t\n', false],
    ['non-breaking spaces', '   ', false],
  ])('judges a proposed name of %s', async (_, name, accepted) => {
    const w = await world();
    const input = { jobs: [{ fromBani: lei(100), name }], labour };

    if (accepted) {
      await save(w, input);
      expect(await proposed(w.garage)).toHaveLength(1);
    } else {
      expect(await refused(save(w, input))).toEqual([
        { code: 'length', field: 'jobs[0].name' },
      ]);
      await nothingStored(w);
    }
  });

  it('answers a name with a NUL character as a refusal or a save, never a raw database error', async () => {
    const w = await world();

    const result = await outcome(
      save(w, {
        jobs: [{ fromBani: lei(100), name: 'Spă\u0000lare' }],
        labour,
      }),
    );

    expect(result).not.toBe('raw error');
  });

  it('refuses an entry that holds both an id and a name', async () => {
    const w = await world();

    const result = await outcome(
      save(w, {
        jobs: [{ fromBani: lei(100), jobTypeId: w.oil, name: 'Altceva' }],
        labour,
      }),
    );

    expect(result).toBe('http 422');
    await nothingStored(w);
  });

  it('refuses an entry that holds neither an id nor a name', async () => {
    const w = await world();

    expect(
      await refused(save(w, { jobs: [{ fromBani: lei(100) }], labour })),
    ).toEqual([{ code: 'required', field: 'jobs[0].jobTypeId' }]);
  });

  it('writes one pending job, one event and one job entry per proposal and no other event', async () => {
    const w = await world();

    await save(w, {
      jobs: [
        { fromBani: lei(100), jobTypeId: w.oil },
        { fromBani: lei(100), name: 'Schimb ambreiaj' },
        { fromBani: lei(100), name: 'Spălare motor' },
      ],
      labour,
    });

    const created = await proposed(w.garage);
    const sent = await events(w.garage);
    expect(created).toHaveLength(2);
    expect(sent.map((e) => e.subjectId).sort()).toEqual(
      created.map((j) => j.id).sort(),
    );
    const entries = await history(w);
    expect(entries.filter((e) => e.subjectType === 'job_type')).toHaveLength(2);
    expect(
      entries.filter((e) => e.subjectType === 'garage_price'),
    ).toHaveLength(3);
    expect(
      await prisma.outboxEvent.count({
        where: {
          createdAt: { gte: entries[0].at },
          kind: { not: 'catalogue_job.proposed' },
          payload: { equals: w.garage, path: ['garageId'] },
        },
      }),
    ).toBe(0);
  });

  it('writes no job, event or entry for a save that proposes nothing', async () => {
    const w = await world();

    await save(w, { jobs: [{ fromBani: lei(100), jobTypeId: w.oil }], labour });

    expect(await proposed(w.garage)).toEqual([]);
    expect(await events(w.garage)).toEqual([]);
  });

  it('proposes a job, gives it a brand range, and stores both prices', async () => {
    const w = await world();

    await save(w, {
      jobs: [
        { brandId: w.dacia, fromBani: lei(90), name: 'Schimb ambreiaj' },
        { fromBani: lei(150), name: 'Schimb ambreiaj' },
      ],
      labour,
    });

    const stored = await rows(w);
    expect(stored).toHaveLength(2);
    expect(stored.filter((r) => r.brandId === w.dacia)).toHaveLength(1);
    expect(await proposed(w.garage)).toHaveLength(1);
  });

  it('keeps no proposed job, event or entry when a later row is refused', async () => {
    const w = await world();

    await refused(
      save(w, {
        jobs: [
          { fromBani: lei(100), name: 'Schimb ambreiaj' },
          { brandId: w.ford, fromBani: lei(100), jobTypeId: w.oil },
          { fromBani: lei(100), jobTypeId: w.oil },
        ],
        labour,
      }),
    );

    await nothingStored(w);
  });

  it('keeps no proposed job, event or entry when the caller fails afterwards', async () => {
    const w = await world();

    await expect(
      prisma.$transaction(async (tx) => {
        await prices.saveStarting(tx, w.garage, w.mihai, {
          jobs: [{ fromBani: lei(100), name: 'Schimb ambreiaj' }],
          labour,
        });
        throw new Error('the listing could not be sent');
      }),
    ).rejects.toThrow('the listing could not be sent');

    await nothingStored(w);
  });

  it('lets two garages propose the same name under different keys', async () => {
    const w = await world();
    const other = await prisma.garage.create({
      data: { name: 'Altul', slug: 'altul' },
    });
    await save(w, {
      jobs: [{ fromBani: lei(100), name: 'Schimb ambreiaj' }],
      labour,
    });

    await prisma.$transaction((tx) =>
      prices.saveStarting(tx, other.id, w.mihai, {
        jobs: [{ fromBani: lei(100), name: 'Schimb ambreiaj' }],
        labour,
      }),
    );

    const keys = (
      await prisma.jobType.findMany({ where: { nameRo: 'Schimb ambreiaj' } })
    ).map((j) => j.key);
    expect(new Set(keys).size).toBe(2);
  });

  it('refuses the same proposal written with different accents and case', async () => {
    const w = await world();

    expect(
      await refused(
        save(w, {
          jobs: [
            { fromBani: lei(100), name: 'Schimb ÎNCĂLZITOR' },
            { fromBani: lei(100), name: 'schimb incalzitor' },
          ],
          labour,
        }),
      ),
    ).toEqual([{ code: 'duplicate', field: 'jobs[1].name' }]);
  });
});

describe('GaragePricesService.saveStarting caps and shapes', () => {
  const many = async (count: number) => {
    await prisma.jobType.createMany({
      data: Array.from({ length: count }, (_, n) => ({
        key: `bulk-${n}`,
        nameEn: `Bulk ${n}`,
        nameRo: `Bulk ${n}`,
        status: 'approved' as const,
      })),
    });
    return (
      await prisma.jobType.findMany({ where: { key: { startsWith: 'bulk-' } } })
    ).map((j) => j.id);
  };

  it('saves exactly fifty jobs without a brand', async () => {
    const w = await world();
    const ids = await many(50);

    await save(w, {
      jobs: ids.map((jobTypeId) => ({ fromBani: lei(100), jobTypeId })),
      labour,
    });

    expect(await rows(w)).toHaveLength(50);
  });

  it('refuses fifty-one distinct jobs with one too_many on jobs and writes nothing', async () => {
    const w = await world();
    const ids = await many(51);

    expect(
      await refused(
        save(w, {
          jobs: ids.map((jobTypeId) => ({ fromBani: lei(100), jobTypeId })),
          labour,
        }),
      ),
    ).toEqual([{ code: 'too_many', field: 'jobs' }]);
    await nothingStored(w);
  });

  it('counts fifty proposals and one catalogue job as fifty-one', async () => {
    const w = await world();

    expect(
      await refused(
        save(w, {
          jobs: [
            { fromBani: lei(100), jobTypeId: w.oil },
            ...Array.from({ length: 50 }, (_, n) => ({
              fromBani: lei(100),
              name: `Lucrare ${n}`,
            })),
          ],
          labour,
        }),
      ),
    ).toEqual([{ code: 'too_many', field: 'jobs' }]);
    await nothingStored(w);
  });

  it('refuses more than five hundred entries in all with too_many on jobs', async () => {
    const w = await world();
    const ids = await many(50);
    const brand = (n: number) =>
      prisma.brand
        .create({ data: { key: `b${n}`, name: `B${n}`, slug: `b${n}` } })
        .then((b) => b.id);
    const brands = [] as string[];
    for (let n = 0; n < 11; n++) brands.push(await brand(n));
    const jobs: StartingPricesInput['jobs'] = ids.map((jobTypeId) => ({
      fromBani: lei(100),
      jobTypeId,
    }));
    for (const jobTypeId of ids)
      for (const brandId of brands)
        jobs.push({ brandId, fromBani: lei(100), jobTypeId });

    const errors = await refused(save(w, { jobs, labour }));

    expect(errors).toContainEqual({ code: 'too_many', field: 'jobs' });
    await nothingStored(w);
  });

  it('answers a labour range with only a top as a missing start', async () => {
    const w = await world();

    expect(
      await refused(
        save(w, {
          jobs: [{ fromBani: lei(100), jobTypeId: w.oil }],
          labour: { toBani: lei(200) } as never,
        }),
      ),
    ).toEqual([{ code: 'required', field: 'labour.from' }]);
  });

  it('answers a missing labour as a refusal, not a server error', async () => {
    const w = await world();

    const result = await outcome(
      save(w, {
        jobs: [{ fromBani: lei(100), jobTypeId: w.oil }],
      } as never),
    );

    expect(result).toBe('http 422');
    await nothingStored(w);
  });

  it.each([
    ['a fractional start', { fromBani: 100.5 }],
    ['a start as a string', { fromBani: '500' as unknown as number }],
    ['a start as NaN', { fromBani: Number.NaN }],
    ['a start as Infinity', { fromBani: Number.POSITIVE_INFINITY }],
    ['a negative start', { fromBani: -500 }],
    ['a start of zero', { fromBani: 0 }],
    ['a start past the maximum', { fromBani: 10_000_001 }],
  ])('refuses a job row with %s as a 422', async (_, ends) => {
    const w = await world();

    const result = await outcome(
      save(w, { jobs: [{ jobTypeId: w.oil, ...ends }], labour }),
    );

    expect(result).toBe('http 422');
    await nothingStored(w);
  });

  it('refuses a payload whose job list is not a list as a 422', async () => {
    const w = await world();

    const result = await outcome(save(w, { jobs: 'oil' as never, labour }));

    expect(result).toBe('http 422');
  });

  it.each([
    ['an entry that is null', () => null],
    ['an entry that is a string', () => 'oil'],
    [
      'a brand id that is a number',
      (oil: string) => ({ brandId: 5, fromBani: lei(100), jobTypeId: oil }),
    ],
    ['a job id that is a number', () => ({ fromBani: lei(100), jobTypeId: 7 })],
    [
      'a proposed name that is a number',
      () => ({ fromBani: lei(100), name: 5 }),
    ],
  ])('refuses %s as an invalid job list, writing nothing', async (_, entry) => {
    const w = await world();

    expect(
      await refused(save(w, { jobs: [entry(w.oil)] as never, labour })),
    ).toEqual([{ code: 'invalid', field: 'jobs' }]);
    await nothingStored(w);
  });
});

describe('GaragePricesService.saveStarting proposing a catalogue name', () => {
  const named = (
    nameRo: string,
    nameEn: string,
    status: 'approved' | 'pending' | 'rejected' = 'approved',
  ) =>
    prisma.jobType.create({
      data: { key: `${status}-${nameEn.length}`, nameEn, nameRo, status },
    });

  it.each([
    ['its Romanian name in other case, accents and spaces', '  SCHIMB ULÉI '],
    ['its English name, case and accent aside', 'oil chânge'],
  ])('refuses a proposal of an approved job by %s', async (_, name) => {
    const w = await world();
    await named('Schimb ulei', 'Oil change');

    expect(
      await refused(
        save(w, {
          jobs: [
            { fromBani: lei(100), jobTypeId: w.oil },
            { fromBani: lei(100), name },
          ],
          labour,
        }),
      ),
    ).toEqual([{ code: 'duplicate', field: 'jobs[1].name' }]);
    await nothingStored(w);
  });

  it('refuses each row that proposes an approved job', async () => {
    const w = await world();
    await named('Schimb ulei', 'Oil change');

    expect(
      await refused(
        save(w, {
          jobs: [
            { fromBani: lei(100), name: 'schimb ulei' },
            { brandId: w.dacia, fromBani: lei(90), name: 'schimb ulei' },
            { fromBani: lei(100), name: 'Schimb ambreiaj' },
            { fromBani: lei(100), name: 'OIL CHANGE' },
          ],
          labour,
        }),
      ),
    ).toEqual([
      { code: 'duplicate', field: 'jobs[0].name' },
      { code: 'duplicate', field: 'jobs[1].name' },
      { code: 'duplicate', field: 'jobs[3].name' },
    ]);
    await nothingStored(w);
  });

  it('names the approved-name error before the brand error of the same row', async () => {
    const w = await world();
    await named('Schimb ulei', 'Oil change');

    expect(
      await refused(
        save(w, {
          jobs: [
            { fromBani: lei(100), name: 'Schimb ulei' },
            { brandId: w.ford, fromBani: lei(90), name: 'Schimb ulei' },
          ],
          labour,
        }),
      ),
    ).toEqual([
      { code: 'duplicate', field: 'jobs[0].name' },
      { code: 'duplicate', field: 'jobs[1].name' },
      { code: 'not_taken', field: 'jobs[1].brandId' },
    ]);
    await nothingStored(w);
  });

  it.each(['pending', 'rejected'] as const)(
    'saves a proposal named like a %s job as a new pending job',
    async (status) => {
      const w = await world();
      await named('Schimb ulei', 'Oil change', status);

      await save(w, {
        jobs: [{ fromBani: lei(100), name: 'Schimb ulei' }],
        labour,
      });

      expect(await proposed(w.garage)).toEqual([
        expect.objectContaining({ nameRo: 'Schimb ulei', status: 'pending' }),
      ]);
    },
  );

  it('refuses a proposal of an approved job whose stored name has surrounding spaces', async () => {
    const w = await world();
    await named(' Schimb ulei ', 'Oil change ');

    expect(
      await refused(
        save(w, { jobs: [{ fromBani: lei(100), name: 'Oil change' }], labour }),
      ),
    ).toEqual([{ code: 'duplicate', field: 'jobs[0].name' }]);
    await nothingStored(w);
  });

  it.each(['Schimb ulei motor', 'Schimb-ulei', 'Schimb  ulei'])(
    'saves the proposal %s, which is not an approved job name',
    async (name) => {
      const w = await world();
      await named('Schimb ulei', 'Oil change');

      await save(w, { jobs: [{ fromBani: lei(100), name }], labour });

      expect(await proposed(w.garage)).toHaveLength(1);
    },
  );
});
