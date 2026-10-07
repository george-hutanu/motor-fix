import { randomUUID } from 'node:crypto';

import {
  type FieldProblem,
  leiToBani,
  type StartingPricesInput,
} from '@motor-fix/contracts';

import {
  afterRace,
  type PricesWorld,
  pricesWorld,
  refused,
} from './garage-prices.testing';
import { audienceOf } from '../../events/audience';
import { Prisma } from '../../generated/prisma/client';

const { history, job, nothingStored, prices, prisma, rows, save, world } =
  pricesWorld();

const lei = leiToBani;
const labour = { fromBani: lei(180), toBani: lei(240) };

describe('GaragePricesService.saveStarting', () => {
  it('stores the labour range and one row per job, in order, visible, stamped by the owner', async () => {
    const w = await world();

    const result = await save(w, {
      jobs: [
        { fromBani: lei(150), jobTypeId: w.diagnosis, toBani: lei(250) },
        { fromBani: lei(350), jobTypeId: w.oil, toBani: lei(500) },
        { fromBani: lei(600), jobTypeId: w.brakes, toBani: lei(1_800) },
      ],
      labour,
    });

    expect(
      await prisma.garage.findUniqueOrThrow({ where: { id: w.garage } }),
    ).toMatchObject({ labourFromBani: 18_000, labourToBani: 24_000 });
    const stored = await rows(w);
    expect(stored).toEqual([
      expect.objectContaining({
        brandId: null,
        durationMinutes: null,
        fromBani: 15_000,
        jobTypeId: w.diagnosis,
        position: 0,
        toBani: 25_000,
        updatedBy: w.mihai,
        visible: true,
      }),
      expect.objectContaining({
        durationMinutes: null,
        jobTypeId: w.oil,
        position: 1,
      }),
      expect.objectContaining({ jobTypeId: w.brakes, position: 2 }),
    ]);
    expect(result).toEqual({
      jobs: stored.map((row) => ({
        brandId: row.brandId,
        durationMinutes: row.durationMinutes,
        fromBani: row.fromBani,
        id: row.id,
        jobTypeId: row.jobTypeId,
        position: row.position,
        toBani: row.toBani,
        visible: true,
        warnings: [],
      })),
      labour: { fromBani: 18_000, toBani: 24_000, warnings: [] },
    });
  });

  it('records the labour range and each row in the history as the owner, scoped to the garage', async () => {
    const w = await world();

    await save(w, {
      jobs: [
        { fromBani: lei(150), jobTypeId: w.diagnosis, toBani: lei(250) },
        { fromBani: lei(350), jobTypeId: w.oil, toBani: lei(500) },
        { fromBani: lei(600), jobTypeId: w.brakes, toBani: lei(1_800) },
      ],
      labour,
    });

    const entries = await history(w);
    expect(entries).toHaveLength(5);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        actorId: w.mihai,
        actorRole: 'owner',
        garageId: w.garage,
      });
    }
    expect(entries.filter((e) => e.subjectType === 'garage')).toEqual([
      expect.objectContaining({
        action: 'update',
        field: 'labour_from_bani',
        newValue: 18_000,
        oldValue: null,
        subjectId: w.garage,
      }),
      expect.objectContaining({
        action: 'update',
        field: 'labour_to_bani',
        newValue: 24_000,
        oldValue: null,
        subjectId: w.garage,
      }),
    ]);
    const stored = await rows(w);
    expect(
      entries
        .filter((e) => e.subjectType === 'garage_price')
        .map((e) => [e.action, e.subjectId]),
    ).toEqual(stored.map((row) => ['create', row.id]));
  });

  it('leaves nothing behind when the caller fails after the write', async () => {
    const w = await world();

    await expect(
      prisma.$transaction(async (tx) => {
        await prices.saveStarting(tx, w.garage, w.mihai, {
          jobs: [{ fromBani: lei(150), jobTypeId: w.diagnosis }],
          labour,
        });
        throw new Error('the listing could not be sent');
      }),
    ).rejects.toThrow('the listing could not be sent');

    await nothingStored(w);
  });

  it('stores a job with only a starting price, visible, with no top', async () => {
    const w = await world();

    await save(w, {
      jobs: [{ fromBani: lei(350), jobTypeId: w.oil }],
      labour,
    });

    expect(await rows(w)).toEqual([
      expect.objectContaining({
        fromBani: 35_000,
        toBani: null,
        visible: true,
      }),
    ]);
  });

  it('saves the labour range alone when no job is priced', async () => {
    const w = await world();

    const result = await save(w, { jobs: [], labour });

    expect(result.jobs).toEqual([]);
    expect(await rows(w)).toEqual([]);
    expect(
      await prisma.garage.findUniqueOrThrow({ where: { id: w.garage } }),
    ).toMatchObject({ labourFromBani: 18_000, labourToBani: 24_000 });
  });

  it('stores a brand range beside the default range of the same job', async () => {
    const w = await world();

    await save(w, {
      jobs: [
        { fromBani: lei(600), jobTypeId: w.brakes, toBani: lei(1_800) },
        {
          brandId: w.dacia,
          fromBani: lei(400),
          jobTypeId: w.brakes,
          toBani: lei(900),
        },
      ],
      labour,
    });

    expect(await rows(w)).toEqual([
      expect.objectContaining({ brandId: null, jobTypeId: w.brakes }),
      expect.objectContaining({ brandId: w.dacia, jobTypeId: w.brakes }),
    ]);
  });

  it('accepts a brand retired from the catalogue', async () => {
    const w = await world();

    await save(w, {
      jobs: [
        { fromBani: lei(600), jobTypeId: w.brakes },
        { brandId: w.lada, fromBani: lei(500), jobTypeId: w.brakes },
      ],
      labour,
    });

    expect(await rows(w)).toHaveLength(2);
  });

  it('stores a wide range and warns on it', async () => {
    const w = await world();

    const result = await save(w, {
      jobs: [{ fromBani: lei(200), jobTypeId: w.brakes, toBani: lei(5_000) }],
      labour: { fromBani: lei(50), toBani: lei(400) },
    });

    expect(result.jobs[0].warnings).toEqual([
      { code: 'wide_range', field: 'to' },
    ]);
    expect(result.labour.warnings).toEqual([
      { code: 'wide_range', field: 'to' },
    ]);
    expect(await rows(w)).toHaveLength(1);
  });

  it('refuses a second default range for a job the garage already priced', async () => {
    const w = await world();
    await save(w, {
      jobs: [{ fromBani: lei(150), jobTypeId: w.diagnosis }],
      labour,
    });
    const before = await rows(w);
    const entries = (await history(w)).length;

    const errors = await refused(
      save(w, {
        jobs: [{ fromBani: lei(200), jobTypeId: w.diagnosis }],
        labour,
      }),
    );

    expect(errors).toEqual([{ code: 'duplicate', field: 'jobs[0].jobTypeId' }]);
    expect(await rows(w)).toEqual(before);
    expect(await history(w)).toHaveLength(entries);
  });

  it('holds one default range per job at the database, brands left empty', async () => {
    const w = await world();
    const row = {
      fromBani: 15_000,
      garageId: w.garage,
      jobTypeId: w.diagnosis,
      position: 0,
      updatedBy: w.mihai,
    };
    await prisma.garagePrice.create({ data: row });

    const error = await prisma.garagePrice
      .create({ data: { ...row, position: 1 } })
      .then(
        () => undefined,
        (e: unknown) => e,
      );

    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((error as Prisma.PrismaClientKnownRequestError).code).toBe('P2002');
  });

  it.each<[string, (w: PricesWorld) => StartingPricesInput, FieldProblem[]]>([
    [
      'an unknown job',
      () => ({
        jobs: [{ fromBani: lei(150), jobTypeId: randomUUID() }],
        labour,
      }),
      [{ code: 'unknown_job', field: 'jobs[0].jobTypeId' }],
    ],
    [
      'a job not yet approved',
      (w) => ({ jobs: [{ fromBani: lei(150), jobTypeId: w.tyres }], labour }),
      [{ code: 'not_approved', field: 'jobs[0].jobTypeId' }],
    ],
    [
      'an unknown brand',
      (w) => ({
        jobs: [
          { fromBani: lei(600), jobTypeId: w.brakes },
          { brandId: randomUUID(), fromBani: lei(500), jobTypeId: w.brakes },
        ],
        labour,
      }),
      [{ code: 'unknown_brand', field: 'jobs[1].brandId' }],
    ],
    [
      'the same job and brand twice',
      (w) => ({
        jobs: [
          { fromBani: lei(150), jobTypeId: w.diagnosis },
          { fromBani: lei(200), jobTypeId: w.diagnosis },
        ],
        labour,
      }),
      [{ code: 'duplicate', field: 'jobs[1].jobTypeId' }],
    ],
    [
      'a brand range with no default range for its job',
      (w) => ({
        jobs: [{ brandId: w.dacia, fromBani: lei(400), jobTypeId: w.brakes }],
        labour,
      }),
      [{ code: 'no_default_range', field: 'jobs[0].brandId' }],
    ],
    [
      'a labour range with no top',
      () => ({ jobs: [], labour: { fromBani: lei(180) } }),
      [{ code: 'required', field: 'labour.to' }],
    ],
    [
      'a top below the starting price',
      (w) => ({
        jobs: [
          { fromBani: lei(1_500), jobTypeId: w.brakes, toBani: lei(1_400) },
        ],
        labour,
      }),
      [{ code: 'below_from', field: 'jobs[0].to' }],
    ],
    [
      'a bad labour range and a bad job start together',
      (w) => ({
        jobs: [{ fromBani: 50, jobTypeId: w.oil }],
        labour: { fromBani: 0, toBani: lei(240) },
      }),
      [
        { code: 'min', field: 'labour.from' },
        { code: 'min', field: 'jobs[0].from' },
      ],
    ],
    [
      'a labour range with no start',
      () => ({
        jobs: [],
        labour: { toBani: lei(240) } as StartingPricesInput['labour'],
      }),
      [{ code: 'required', field: 'labour.from' }],
    ],
    [
      'an entry with neither a job nor a name',
      () => ({ jobs: [{ fromBani: lei(150) }], labour }),
      [{ code: 'required', field: 'jobs[0].jobTypeId' }],
    ],
    [
      'an entry with both a job and a name',
      (w) => ({
        jobs: [{ fromBani: lei(150), jobTypeId: w.oil, name: 'Ulei' }],
        labour,
      }),
      [{ code: 'required', field: 'jobs[0].jobTypeId' }],
    ],
    [
      'a proposed name of one letter',
      () => ({ jobs: [{ fromBani: lei(150), name: ' A ' }], labour }),
      [{ code: 'length', field: 'jobs[0].name' }],
    ],
    [
      'a proposed name over 80 characters',
      () => ({ jobs: [{ fromBani: lei(150), name: 'x'.repeat(81) }], labour }),
      [{ code: 'length', field: 'jobs[0].name' }],
    ],
    [
      'the same proposed name twice, accents and case aside',
      () => ({
        jobs: [
          { fromBani: lei(150), name: 'Schimb ambreiaj' },
          { fromBani: lei(150), name: 'SCHÎMB ambreiaj ' },
        ],
        labour,
      }),
      [{ code: 'duplicate', field: 'jobs[1].name' }],
    ],
    [
      'a brand range for a brand the garage has not taken',
      (w) => ({
        jobs: [
          { fromBani: lei(600), jobTypeId: w.brakes },
          { brandId: w.ford, fromBani: lei(500), jobTypeId: w.brakes },
        ],
        labour,
      }),
      [{ code: 'not_taken', field: 'jobs[1].brandId' }],
    ],
    [
      '51 jobs without a brand',
      (w) => ({
        jobs: Array.from({ length: 51 }, () => ({
          fromBani: lei(150),
          jobTypeId: w.oil,
        })),
        labour,
      }),
      [{ code: 'too_many', field: 'jobs' }],
    ],
    [
      '501 entries in all',
      (w) => ({
        jobs: [
          { fromBani: lei(600), jobTypeId: w.brakes },
          ...Array.from({ length: 500 }, () => ({
            brandId: w.dacia,
            fromBani: lei(500),
            jobTypeId: w.brakes,
          })),
        ],
        labour,
      }),
      [{ code: 'too_many', field: 'jobs' }],
    ],
  ])('refuses %s and stores nothing', async (_, input, expected) => {
    const w = await world();

    const errors = await refused(save(w, input(w)));

    expect(errors).toEqual(expected);
    await nothingStored(w);
  });
});

describe('a job the garage proposes', () => {
  const proposal = (w: PricesWorld): StartingPricesInput => ({
    jobs: [
      { fromBani: lei(150), jobTypeId: w.diagnosis },
      { fromBani: lei(400), name: '  Schimb ambreiaj ', toBani: lei(900) },
    ],
    labour,
  });

  it('becomes a pending catalogue job of that garage, priced like any other', async () => {
    const w = await world();

    const result = await save(w, proposal(w));

    const proposed = await prisma.jobType.findFirstOrThrow({
      where: { proposedByGarageId: w.garage },
    });
    expect(proposed).toMatchObject({
      key: 'schimb-ambreiaj',
      nameEn: 'Schimb ambreiaj',
      nameRo: 'Schimb ambreiaj',
      status: 'pending',
    });
    expect(await rows(w)).toEqual([
      expect.objectContaining({ jobTypeId: w.diagnosis, position: 0 }),
      expect.objectContaining({
        fromBani: 40_000,
        jobTypeId: proposed.id,
        position: 1,
        toBani: 90_000,
      }),
    ]);
    expect(result.jobs[1].jobTypeId).toBe(proposed.id);
  });

  it('tells the platform admins, with ids only', async () => {
    const w = await world();

    await save(w, proposal(w));

    const proposed = await prisma.jobType.findFirstOrThrow({
      where: { proposedByGarageId: w.garage },
    });
    const events = await prisma.outboxEvent.findMany({
      where: { kind: 'catalogue_job.proposed', subjectId: proposed.id },
    });
    expect(events).toEqual([
      expect.objectContaining({
        audience: audienceOf({ adminOnly: true, type: 'platform' }),
        payload: { garageId: w.garage, jobTypeId: proposed.id },
      }),
    ]);
  });

  it('records the new job in the history as the owner', async () => {
    const w = await world();

    await save(w, proposal(w));

    const proposed = await prisma.jobType.findFirstOrThrow({
      where: { proposedByGarageId: w.garage },
    });
    expect(
      (await history(w)).filter((e) => e.subjectType === 'job_type'),
    ).toEqual([
      expect.objectContaining({
        action: 'create',
        actorId: w.mihai,
        subjectId: proposed.id,
      }),
    ]);
  });

  it('takes the next free key when the name is already a key', async () => {
    const w = await world();
    await job('schimb-ambreiaj', 'pending');
    await job('schimb-ambreiaj-2', 'pending');

    await save(w, proposal(w));

    expect(
      await prisma.jobType.findFirstOrThrow({
        where: { proposedByGarageId: w.garage },
      }),
    ).toMatchObject({ key: 'schimb-ambreiaj-3' });
  });

  it('leaves no job and no event behind when the caller fails after the write', async () => {
    const w = await world();

    await expect(
      prisma.$transaction(async (tx) => {
        await prices.saveStarting(tx, w.garage, w.mihai, proposal(w));
        throw new Error('the listing could not be sent');
      }),
    ).rejects.toThrow('the listing could not be sent');

    await nothingStored(w);
  });

  it('refuses a pending job another garage proposed', async () => {
    const w = await world();
    const other = await prisma.garage.create({
      data: { name: 'Alt service', slug: `alt-${randomUUID()}` },
    });
    const theirs = await prisma.jobType.create({
      data: {
        key: 'polish',
        nameEn: 'Polish',
        nameRo: 'Polish',
        proposedByGarageId: other.id,
        status: 'pending',
      },
    });

    const errors = await refused(
      save(w, { jobs: [{ fromBani: lei(150), jobTypeId: theirs.id }], labour }),
    );

    expect(errors).toEqual([
      { code: 'not_approved', field: 'jobs[0].jobTypeId' },
    ]);
    await nothingStored(w);
  });
});

describe('a range stored by a concurrent save', () => {
  it('is refused as a duplicate, not a server error', async () => {
    const w = await world();
    const input: StartingPricesInput = {
      jobs: [{ fromBani: lei(150), jobTypeId: w.diagnosis }],
      labour,
    };
    const second = afterRace(
      prisma,
      (tx) => prices.saveStarting(tx, w.garage, w.mihai, input),
      () => refused(save(w, input)),
    );

    expect(await second).toEqual([
      { code: 'duplicate', field: 'jobs[0].jobTypeId' },
    ]);
  });
});
